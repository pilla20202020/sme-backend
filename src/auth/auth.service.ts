import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import jwkToPem from 'jwk-to-pem';
import { PrismaService } from '../prisma/prisma.service';

/** Distinguishes a locally-issued session token (STORY-005, tenant-invited
 * staff logging in with email/password) from an externally-issued SSO
 * token — JwtAuthGuard branches its verification path on this claim. */
const LOCAL_TOKEN_TYPE = 'local';
const LOCAL_TOKEN_TTL_SECONDS = 60 * 60;

type RsaJwk = {
  kty: 'RSA';
  kid: string;
  n: string;
  e: string;
};

type JwksResponse = {
  keys: RsaJwk[];
};

export type AccessTokenPayload = jwt.JwtPayload & {
  sub: string;
  tokenType?: string;
};

export type ResolvedUser = {
  userId: number;
  /** Null for platform-admin/support accounts, which aren't scoped to a tenant. */
  tenantId: number | null;
  /** Null whenever tenantId is null, for the same reason. */
  tenantName: string | null;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
};

export type LoginResult = {
  token: string;
  expiresInSeconds: number;
  user: ResolvedUser;
};

type SsoUser = {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  user_type: string;
};

// Provisional: maps an external SSO user_type to a local role name for
// auto-provisioned staff accounts. Revisit once the identity-provider
// strategy for tenant business users (OQ-06) is decided — this path may
// end up serving only internal admin/support staff, not tenant owners.
const SSO_ROLE_MAP: Record<string, string> = {
  ADMIN: 'admin',
};
const DEFAULT_ROLE = 'admin';

@Injectable()
export class AuthService {
  private readonly jwksUri: string;

  private readonly appInitUri: string;

  private readonly issuer?: string;

  private readonly audience?: string;

  /** Signs/verifies locally-issued session tokens for tenant-invited staff
   * (STORY-005) — distinct from the external SSO's RS256/JWKS keys. Falls
   * back to a dev-only default outside production so local login works
   * out of the box in a fresh checkout; production must set a real secret. */
  private readonly localJwtSecret: string;

  private readonly keyCache = new Map<string, string>();

  private readonly cacheTtlMs = 5 * 60 * 1000;

  private lastCacheRefresh = 0;

  private pendingRefresh: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.jwksUri =
      this.configService.get<string>('SSO_JWKS_URI') ??
      this.configService.get<string>('AUTH_JWKS_URI') ??
      '';
    this.appInitUri = this.configService.get<string>('SSO_APP_INIT_URI') ?? '';
    this.issuer =
      this.configService.get<string>('SSO_ISSUER') ??
      this.configService.get<string>('AUTH_ISSUER');
    this.audience =
      this.configService.get<string>('SSO_AUDIENCE') ??
      this.configService.get<string>('AUTH_AUDIENCE');

    const configuredSecret = this.configService.get<string>(
      'AUTH_LOCAL_JWT_SECRET',
    );
    if (!configuredSecret && process.env.NODE_ENV === 'production') {
      throw new Error(
        'AUTH_LOCAL_JWT_SECRET must be set in production for tenant-user login',
      );
    }
    this.localJwtSecret = configuredSecret ?? 'dev-only-insecure-local-secret';
  }

  decodeToken(token: string): AccessTokenPayload | null {
    const decoded = jwt.decode(token) as jwt.JwtPayload | null;
    if (!decoded?.sub) return null;
    return decoded as AccessTokenPayload;
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    if (!this.jwksUri) {
      throw new UnauthorizedException('SSO JWKS URI is not configured');
    }

    try {
      const decoded = jwt.decode(token, { complete: true });
      const keyId: string | undefined = decoded?.header?.kid;

      const publicKeys = keyId
        ? [await this.getSigningKey(keyId)]
        : await this.getAllSigningKeys();

      if (publicKeys.length === 0) {
        throw new UnauthorizedException('No signing keys available');
      }

      let payload: jwt.JwtPayload | null = null;
      let lastError: Error | null = null;

      for (const publicKey of publicKeys) {
        try {
          payload = await new Promise<jwt.JwtPayload>((resolve, reject) => {
            jwt.verify(
              token,
              publicKey,
              {
                algorithms: ['RS256'],
                issuer: this.issuer,
                audience: this.audience,
              },
              (error, verifiedPayload) => {
                if (error) {
                  reject(error);
                  return;
                }
                if (!verifiedPayload || typeof verifiedPayload === 'string') {
                  reject(
                    new UnauthorizedException('Invalid access token payload'),
                  );
                  return;
                }
                resolve(verifiedPayload);
              },
            );
          });
          break;
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
        }
      }

      if (!payload) {
        throw lastError ?? new UnauthorizedException('Invalid access token');
      }

      if (!payload.sub) {
        throw new UnauthorizedException('Access token subject is missing');
      }

      return payload as AccessTokenPayload;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        console.error(
          '[AuthService] verifyAccessToken unauthorized:',
          err.message,
        );
        throw err;
      }
      console.error('[AuthService] verifyAccessToken failed:', err);
      throw new UnauthorizedException('Invalid access token');
    }
  }

  /**
   * Verifies a locally-issued session token (STORY-005) — HS256, signed
   * with localJwtSecret, distinct from the SSO's externally-verified RS256
   * tokens. Never accepts a token missing the `local` tokenType claim, so
   * an SSO token can never be replayed through this path or vice versa.
   */
  verifyLocalToken(token: string): AccessTokenPayload {
    try {
      const payload = jwt.verify(token, this.localJwtSecret, {
        algorithms: ['HS256'],
      }) as jwt.JwtPayload;

      if (payload.tokenType !== LOCAL_TOKEN_TYPE || !payload.sub) {
        throw new UnauthorizedException('Invalid session token');
      }

      return payload as AccessTokenPayload;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired session token');
    }
  }

  /**
   * Authenticates a tenant-invited staff member by email/password
   * (STORY-005) and issues a locally-signed session token. Platform-admin
   * accounts (no passwordHash — they authenticate via SSO only) can never
   * log in through this path.
   */
  async login(email: string, password: string): Promise<LoginResult | null> {
    const dbUser = await this.prisma.user.findUnique({
      where: { email },
      select: { userId: true, passwordHash: true, isActive: true },
    });

    if (!dbUser || !dbUser.isActive || !dbUser.passwordHash) {
      return null;
    }

    const passwordMatches = await bcrypt.compare(password, dbUser.passwordHash);
    if (!passwordMatches) {
      return null;
    }

    const user = await this.resolveUserById(dbUser.userId);
    if (!user) {
      return null;
    }

    const token = jwt.sign(
      { sub: String(dbUser.userId), tokenType: LOCAL_TOKEN_TYPE },
      this.localJwtSecret,
      { algorithm: 'HS256', expiresIn: LOCAL_TOKEN_TTL_SECONDS },
    );

    await this.prisma.user.update({
      where: { userId: dbUser.userId },
      data: { lastLoggedInAt: new Date() },
    });

    return { token, expiresInSeconds: LOCAL_TOKEN_TTL_SECONDS, user };
  }

  async resolveUser(ssoUserId: number): Promise<ResolvedUser | null> {
    return this.resolveUserByWhere({ ssoUserId });
  }

  /** Resolves a tenant-invited (non-SSO) user by their own userId — used for
   * locally-issued session tokens (STORY-005), since these users have no
   * ssoUserId to look up by. */
  async resolveUserById(userId: number): Promise<ResolvedUser | null> {
    return this.resolveUserByWhere({ userId });
  }

  private async resolveUserByWhere(
    where: Prisma.UserWhereUniqueInput,
  ): Promise<ResolvedUser | null> {
    const dbUser = await this.prisma.user.findUnique({
      where,
      select: {
        userId: true,
        tenantId: true,
        tenant: { select: { name: true } },
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        roles: {
          select: {
            role: {
              select: {
                roleName: true,
                permissions: {
                  select: {
                    permission: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!dbUser || !dbUser.isActive) {
      return null;
    }

    const roles = dbUser.roles.map((ur) => ur.role.roleName);
    const permissions = [
      ...new Set(
        dbUser.roles.flatMap((ur) =>
          ur.role.permissions.map((rp) => rp.permission.name),
        ),
      ),
    ];

    return {
      userId: dbUser.userId,
      tenantId: dbUser.tenantId,
      tenantName: dbUser.tenant?.name ?? null,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      roles,
      permissions,
    };
  }

  async resolveOrProvisionUser(
    ssoUserId: number,
    token: string,
  ): Promise<ResolvedUser | null> {
    const existing = await this.resolveUser(ssoUserId);
    if (existing) return existing;

    const ssoUser = await this.fetchSsoUser(token);
    if (!ssoUser) return null;

    const roleName =
      SSO_ROLE_MAP[(ssoUser.user_type ?? '').toUpperCase()] ?? DEFAULT_ROLE;

    const role = await this.prisma.role.findFirst({
      where: { roleName },
    });

    const [firstName, ...rest] = ssoUser.name.trim().split(' ');
    const lastName = rest.join(' ');

    if (!role) {
      console.warn(
        `[AuthService] No DB role found for SSO user_type "${ssoUser.user_type}" (mapped to "${roleName}"). User will be created with no roles.`,
      );
    }

    try {
      await this.prisma.user.create({
        data: {
          ssoUserId: ssoUser.id,
          email: ssoUser.email,
          firstName,
          lastName,
          phone: ssoUser.phone ?? undefined,
          isActive: true,
          ...(role && {
            roles: { create: { roleId: role.roleId } },
          }),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = err.meta?.target;
        const conflictFields = Array.isArray(target) ? target : [target];

        // Concurrent first-login: another request already created this
        // exact SSO user between our lookup and this insert — safe to just
        // resolve what's now there.
        if (conflictFields.includes('sso_user_id')) {
          return this.resolveUser(ssoUser.id);
        }

        // A DIFFERENT collision — most likely email, e.g. this SSO user's
        // email matches an existing tenant-invited (non-SSO) user's row.
        // Silently falling through to resolveUser(ssoUser.id) here would
        // return null (no row has this ssoUserId), surfacing as a generic
        // "user not found" with no signal for ops to diagnose. Fail loudly
        // and specifically instead.
        console.error(
          `[AuthService] SSO provisioning for "${ssoUser.email}" hit a non-ssoUserId unique conflict (${JSON.stringify(conflictFields)}) — likely an email collision with an existing account.`,
        );
        throw new InternalServerErrorException(
          'Unable to provision user — email is already associated with a different account',
        );
      }
      throw err;
    }

    return this.resolveUser(ssoUser.id);
  }

  private async fetchSsoUser(token: string): Promise<SsoUser | null> {
    if (!this.appInitUri) {
      console.warn(
        '[AuthService] SSO_APP_INIT_URI is not configured — user auto-provisioning is disabled',
      );
      return null;
    }

    let res: Response;
    try {
      res = await fetch(this.appInitUri, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error(
        '[AuthService] fetchSsoUser network error:',
        err instanceof Error ? err.message : err,
      );
      throw new InternalServerErrorException(
        'Unable to reach SSO for user provisioning',
      );
    }

    if (!res.ok) {
      let rawBody = '';
      try {
        rawBody = await res.text();
      } catch {
        /* ignore */
      }
      console.error(
        `[AuthService] SSO app-init responded ${res.status}:`,
        rawBody,
      );
      throw new UnauthorizedException(
        'SSO rejected the token during provisioning',
      );
    }

    const body = (await res.json()) as { status: string; user?: SsoUser };
    if (body.status !== 'success' || !body.user) {
      console.error(
        '[AuthService] SSO app-init unexpected response body:',
        JSON.stringify(body),
      );
      throw new InternalServerErrorException(
        'Unexpected response from SSO during provisioning',
      );
    }

    return body.user;
  }

  private async getSigningKey(kid: string): Promise<string> {
    const now = Date.now();
    const cachedKey = this.keyCache.get(kid);
    if (cachedKey && now - this.lastCacheRefresh < this.cacheTtlMs) {
      return cachedKey;
    }

    await this.ensureJwksLoaded();

    const key = this.keyCache.get(kid);
    if (!key) {
      throw new UnauthorizedException('Signing key not found');
    }

    return key;
  }

  private async getAllSigningKeys(): Promise<string[]> {
    const now = Date.now();
    if (
      this.keyCache.size === 0 ||
      now - this.lastCacheRefresh >= this.cacheTtlMs
    ) {
      await this.ensureJwksLoaded();
    }
    return [...this.keyCache.values()];
  }

  private async ensureJwksLoaded(): Promise<void> {
    if (!this.pendingRefresh) {
      this.pendingRefresh = this.refreshJwks().finally(() => {
        this.pendingRefresh = null;
      });
    }
    await this.pendingRefresh;
  }

  private async refreshJwks(): Promise<void> {
    if (!this.jwksUri) {
      throw new UnauthorizedException('SSO JWKS URI is not configured');
    }

    const response = await fetch(this.jwksUri);
    if (!response.ok) {
      throw new UnauthorizedException('Unable to retrieve JWKS');
    }

    const body = (await response.json()) as JwksResponse;
    if (!Array.isArray(body.keys)) {
      throw new UnauthorizedException('Invalid JWKS response');
    }

    this.keyCache.clear();
    for (const key of body.keys) {
      if (key.kty !== 'RSA' || !key.kid || !key.n || !key.e) {
        continue;
      }

      const pem = jwkToPem({
        kty: key.kty,
        n: key.n,
        e: key.e,
      });
      this.keyCache.set(key.kid, pem);
    }

    this.lastCacheRefresh = Date.now();
  }
}
