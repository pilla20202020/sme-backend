import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedUser } from '../jwt-auth.guard';

type ScopedRequest = Request & {
  user?: AuthenticatedUser;
  params: Record<string, string>;
};

/**
 * Minimal, early slice of STORY-004's tenant-scoping guard: enforces that a
 * caller can only act on the tenant they were invited into, for any route
 * with a `:tenantId` path parameter. A role-based permission (e.g.
 * branch:read) is necessary but not sufficient on its own — without this
 * check, a manager invited into tenant 1 could use that same permission
 * against tenant 2's data just by changing the URL, since permissions are
 * granted per role, not per tenant membership.
 *
 * Platform admin accounts (tenantId: null) bypass this check — they are not
 * scoped to any single tenant by design (tenant governance/support).
 *
 * The remaining STORY-004 scope (applying this uniformly across every
 * future tenant-owned resource, background/async job tenant context, and a
 * more general reusable mechanism) is still open — this guard only covers
 * the routes it has been explicitly applied to so far.
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const user = request.user;

    if (!user) {
      // No authenticated user means JwtAuthGuard already let this request
      // through as @Public() (an unauthenticated request on a protected
      // route would already have been rejected with 401 before this guard
      // ever runs) — nothing for tenant-scoping to check here.
      return true;
    }

    if (user.roles.includes('admin')) {
      return true;
    }

    const rawTenantId = request.params.tenantId;
    if (rawTenantId === undefined) {
      // No :tenantId on this route — nothing for this guard to check.
      return true;
    }

    // Parse as strictly as ParseIntPipe does (plain decimal digits only) so
    // this guard and the controller's own param parsing can never disagree
    // on what the path segment "is" — Number("1e2") === 100 would otherwise
    // let this guard approve a request that ParseIntPipe then resolves to a
    // completely different tenantId (1). A value that isn't a clean integer
    // is rejected outright rather than silently passed through.
    if (!/^\d+$/.test(rawTenantId)) {
      throw new ForbiddenException('Invalid tenant identifier');
    }
    const pathTenantId = parseInt(rawTenantId, 10);

    if (user.tenantId !== pathTenantId) {
      throw new ForbiddenException('You do not have access to this tenant');
    }

    return true;
  }
}
