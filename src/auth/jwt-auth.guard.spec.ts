import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
interface TestRequest {
  headers: Record<string, string>;
  cookies: Record<string, string>;
  user?: any;
}

describe('JwtAuthGuard', () => {
  const mockReflector = (isPublic: boolean): Reflector =>
    ({ getAllAndOverride: jest.fn().mockReturnValue(isPublic) }) as never;

  const mockAuthService = (
    payload: object | null,
    resolved: object | null,
  ) => ({
    decodeToken: jest.fn().mockReturnValue(payload),
    verifyAccessToken: jest.fn().mockResolvedValue(payload),
    resolveUser: jest.fn().mockResolvedValue(resolved),
    verifyLocalToken: jest.fn().mockReturnValue(payload),
    resolveUserById: jest.fn().mockResolvedValue(resolved),
  });

  const makeContext = (cookie?: string): ExecutionContext => {
    const request: Record<string, unknown> = {
      headers: {},
      cookies: cookie ? { uw_access_token: cookie } : {},
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  it('bypasses auth for public routes', async () => {
    const guard = new JwtAuthGuard(
      mockAuthService(null, null) as never,
      mockReflector(true),
    );
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('throws when uw_access_token cookie is missing', async () => {
    const guard = new JwtAuthGuard(
      mockAuthService(null, null) as never,
      mockReflector(false),
    );
    await expect(guard.canActivate(makeContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws when token sub is non-numeric', async () => {
    const guard = new JwtAuthGuard(
      mockAuthService({ sub: 'not-a-number' }, null) as never,
      mockReflector(false),
    );
    await expect(guard.canActivate(makeContext('tok'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws when user is not found in DB', async () => {
    const guard = new JwtAuthGuard(
      mockAuthService({ sub: '42' }, null) as never,
      mockReflector(false),
    );
    await expect(guard.canActivate(makeContext('tok'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('sets request.user and returns true for a valid cookie', async () => {
    const resolved = {
      userId: 7,
      roles: ['admin'],
      permissions: ['user:read'],
    };
    const authService = mockAuthService({ sub: '42' }, resolved);
    const guard = new JwtAuthGuard(authService as never, mockReflector(false));
    const context = makeContext('tok');
    const request = context.switchToHttp().getRequest<TestRequest>();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authService.verifyAccessToken).toHaveBeenCalledWith('tok');
    expect(request.user).toMatchObject({
      sub: '42',
      userId: 7,
      roles: ['admin'],
    });
  });

  it('caches resolved user and skips resolveUser on second call', async () => {
    const resolved = {
      userId: 7,
      roles: ['admin'],
      permissions: ['user:read'],
    };
    const authService = mockAuthService({ sub: '42' }, resolved);
    const guard = new JwtAuthGuard(authService as never, mockReflector(false));

    await guard.canActivate(makeContext('tok'));
    await guard.canActivate(makeContext('tok'));

    expect(authService.resolveUser).toHaveBeenCalledTimes(1);
  });

  it('re-fetches user after cache TTL expires', async () => {
    jest.useFakeTimers();
    const resolved = {
      userId: 7,
      roles: ['admin'],
      permissions: ['user:read'],
    };
    const authService = mockAuthService({ sub: '42' }, resolved);
    const guard = new JwtAuthGuard(authService as never, mockReflector(false));

    await guard.canActivate(makeContext('tok'));
    jest.advanceTimersByTime(31_000);
    await guard.canActivate(makeContext('tok'));

    expect(authService.resolveUser).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  describe('local (tenant-invited staff, STORY-005) tokens', () => {
    const localPayload = { sub: '9', tokenType: 'local' };

    it('routes a local-token cookie to verifyLocalToken/resolveUserById, not the SSO path', async () => {
      const resolved = {
        userId: 9,
        tenantId: 1,
        roles: ['manager'],
        permissions: ['branch:read'],
      };
      const authService = mockAuthService(localPayload, resolved);
      const guard = new JwtAuthGuard(
        authService as never,
        mockReflector(false),
      );
      const context = makeContext('local-tok');
      const request = context.switchToHttp().getRequest<TestRequest>();

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(authService.verifyLocalToken).toHaveBeenCalledWith('local-tok');
      expect(authService.resolveUserById).toHaveBeenCalledWith(9);
      expect(authService.verifyAccessToken).not.toHaveBeenCalled();
      expect(authService.resolveUser).not.toHaveBeenCalled();
      expect(request.user).toMatchObject({ userId: 9, tenantId: 1 });
    });

    it('throws when the local user is not found or inactive', async () => {
      const authService = mockAuthService(localPayload, null);
      const guard = new JwtAuthGuard(
        authService as never,
        mockReflector(false),
      );
      await expect(guard.canActivate(makeContext('local-tok'))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does not let an SSO ssoUserId and a local userId collide in the cache', async () => {
      // Same numeric id (5), different token types — must resolve independently.
      const ssoResolved = { userId: 100, roles: ['admin'], permissions: [] };
      const localResolved = {
        userId: 5,
        tenantId: 2,
        roles: ['cashier'],
        permissions: [],
      };

      const authService = {
        decodeToken: jest
          .fn()
          .mockReturnValueOnce({ sub: '5' }) // SSO call
          .mockReturnValueOnce({ sub: '5', tokenType: 'local' }), // local call
        verifyAccessToken: jest.fn().mockResolvedValue({ sub: '5' }),
        resolveUser: jest.fn().mockResolvedValue(ssoResolved),
        verifyLocalToken: jest
          .fn()
          .mockReturnValue({ sub: '5', tokenType: 'local' }),
        resolveUserById: jest.fn().mockResolvedValue(localResolved),
      };
      const guard = new JwtAuthGuard(
        authService as never,
        mockReflector(false),
      );

      const ssoContext = makeContext('sso-tok');
      await guard.canActivate(ssoContext);
      const localContext = makeContext('local-tok');
      await guard.canActivate(localContext);

      const ssoRequest = ssoContext.switchToHttp().getRequest<TestRequest>();
      const localRequest = localContext
        .switchToHttp()
        .getRequest<TestRequest>();
      expect(ssoRequest.user).toMatchObject({ userId: 100 });
      expect(localRequest.user).toMatchObject({ userId: 5, tenantId: 2 });
    });
  });
});
