import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantScopeGuard } from './tenant-scope.guard';

describe('TenantScopeGuard', () => {
  const makeContext = (
    params: Record<string, string>,
    user?: { roles: string[]; tenantId: number | null },
  ): ExecutionContext => {
    const request = { params, user };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  const guard = new TenantScopeGuard();

  it('passes through when there is no authenticated user (a @Public() route)', () => {
    expect(guard.canActivate(makeContext({ tenantId: '1' }))).toBe(true);
  });

  it('passes through for an admin regardless of the path tenantId', () => {
    const context = makeContext(
      { tenantId: '999' },
      { roles: ['admin'], tenantId: null },
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('passes through when the route has no :tenantId param at all', () => {
    const context = makeContext({}, { roles: ['owner'], tenantId: 1 });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a non-admin whose own tenantId matches the path', () => {
    const context = makeContext(
      { tenantId: '1' },
      { roles: ['owner'], tenantId: 1 },
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a non-admin whose own tenantId does not match the path', () => {
    const context = makeContext(
      { tenantId: '2' },
      { roles: ['owner'], tenantId: 1 },
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a non-numeric path tenantId rather than silently passing through', () => {
    const context = makeContext(
      { tenantId: 'abc' },
      { roles: ['owner'], tenantId: 1 },
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects scientific-notation-style input instead of letting Number() coerce it', () => {
    // Number("1e2") === 100, but ParseIntPipe's parseInt("1e2", 10) === 1 —
    // if this guard used Number() it could approve tenantId 100 while the
    // controller then acts on tenantId 1. Reject anything that isn't plain
    // decimal digits outright.
    const context = makeContext(
      { tenantId: '1e2' },
      { roles: ['owner'], tenantId: 100 },
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a path tenantId with leading/trailing whitespace', () => {
    const context = makeContext(
      { tenantId: ' 1' },
      { roles: ['owner'], tenantId: 1 },
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
