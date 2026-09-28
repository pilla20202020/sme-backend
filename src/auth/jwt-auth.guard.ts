import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AccessTokenPayload, AuthService, ResolvedUser } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';

export type AuthenticatedUser = AccessTokenPayload & ResolvedUser;

type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
  cookies?: {
    uw_access_token?: string;
    [key: string]: string | undefined;
  };
};

const LOCAL_TOKEN_TYPE = 'local';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  // Keyed by "sso:<ssoUserId>" or "local:<userId>" — never a bare number.
  // ssoUserId (assigned by an external IdP) and userId (our own autoincrement
  // PK) are different numbering spaces that can collide on the same number,
  // so a bare-number cache key could serve one user's resolved data under
  // another user's token.
  private readonly userCache = new Map<
    string,
    { data: ResolvedUser; expiresAt: number }
  >();
  private readonly cacheTtlMs = 30_000;

  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.uw_access_token;

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    // Decode only (no verify) to route to the right verification path and
    // cache key — the local/SSO branch below fully verifies the signature
    // either way before trusting anything from this decode.
    const unverified = this.authService.decodeToken(token);
    const isLocalToken = unverified?.tokenType === LOCAL_TOKEN_TYPE;

    if (isLocalToken) {
      return this.authenticateLocal(unverified, token, request);
    }
    return this.authenticateSso(unverified, token, request);
  }

  private async authenticateLocal(
    unverified: AccessTokenPayload | null,
    token: string,
    request: AuthenticatedRequest,
  ): Promise<boolean> {
    const userIdRaw = unverified ? Number(unverified.sub) : NaN;
    const cacheKey = Number.isInteger(userIdRaw) ? `local:${userIdRaw}` : null;

    if (cacheKey) {
      const cached = this.userCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        // Still verify the signature for cached entries to catch revoked/tampered tokens
        const payload = this.authService.verifyLocalToken(token);
        request.user = { ...payload, ...cached.data };
        return true;
      }
      if (cached) {
        this.userCache.delete(cacheKey);
      }
    }

    const payload = this.authService.verifyLocalToken(token);
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId)) {
      throw new UnauthorizedException('Invalid token subject');
    }

    const resolved = await this.authService.resolveUserById(userId);
    if (!resolved) {
      throw new UnauthorizedException('User not found or inactive');
    }

    this.userCache.set(`local:${userId}`, {
      data: resolved,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    request.user = { ...payload, ...resolved };
    return true;
  }

  private async authenticateSso(
    unverified: AccessTokenPayload | null,
    token: string,
    request: AuthenticatedRequest,
  ): Promise<boolean> {
    const ssoUserIdRaw = unverified ? Number(unverified.sub) : NaN;
    const cacheKey = Number.isInteger(ssoUserIdRaw)
      ? `sso:${ssoUserIdRaw}`
      : null;

    if (cacheKey) {
      const cached = this.userCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        // Still verify the signature for cached entries to catch revoked/tampered tokens
        const payload = await this.authService.verifyAccessToken(token);
        request.user = { ...payload, ...cached.data };
        return true;
      }
      if (cached) {
        this.userCache.delete(cacheKey);
      }
    }

    const payload = await this.authService.verifyAccessToken(token);

    const ssoUserId = Number(payload.sub);
    if (!Number.isInteger(ssoUserId)) {
      throw new UnauthorizedException('Invalid token subject');
    }

    const resolved = await this.authService.resolveUser(ssoUserId);
    if (!resolved) {
      throw new UnauthorizedException('User not found or inactive');
    }

    this.userCache.set(`sso:${ssoUserId}`, {
      data: resolved,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    request.user = { ...payload, ...resolved };
    return true;
  }
}
