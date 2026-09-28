import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './jwt-auth.guard';

const mockAuthService = {
  verifyAccessToken: jest.fn(),
  resolveOrProvisionUser: jest.fn(),
};

const mockRes = (): Partial<{ cookie: jest.Mock }> => ({
  cookie: jest.fn().mockReturnThis(),
});

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /auth/session', () => {
    it('creates session cookie and returns profile', async () => {
      const payload = { sub: '42', exp: Math.floor(Date.now() / 1000) + 3600 };
      mockAuthService.verifyAccessToken.mockResolvedValue(payload);
      mockAuthService.resolveOrProvisionUser.mockResolvedValue({
        userId: 7,
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        roles: ['admin'],
        permissions: ['user:read'],
      });
      const res = mockRes();

      const result = await controller.createSession(
        { access_token: 'tok' },
        res as unknown as never,
      );

      expect(mockAuthService.verifyAccessToken).toHaveBeenCalledWith('tok');
      expect(mockAuthService.resolveOrProvisionUser).toHaveBeenCalledWith(
        42,
        'tok',
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'uw_access_token',
        'tok',
        expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
      );
      expect(result).toEqual({
        userId: 7,
        sub: '42',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        roles: ['admin'],
        permissions: ['user:read'],
      });
    });

    it('throws 401 when token is invalid', async () => {
      mockAuthService.verifyAccessToken.mockRejectedValue(
        new UnauthorizedException('Invalid access token'),
      );
      const res = mockRes() as unknown as never;

      await expect(
        controller.createSession({ access_token: 'bad' }, res),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 404 when user is not in DB', async () => {
      mockAuthService.verifyAccessToken.mockResolvedValue({
        sub: '99',
        exp: 9999999999,
      });
      mockAuthService.resolveOrProvisionUser.mockResolvedValue(null);
      const res = mockRes() as unknown as never;

      await expect(
        controller.createSession({ access_token: 'tok' }, res),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 401 when sub is a float string', async () => {
      mockAuthService.verifyAccessToken.mockResolvedValue({
        sub: '42.5',
        exp: 9999999999,
      });
      const res = mockRes() as unknown as never;
      await expect(
        controller.createSession({ access_token: 'tok' }, res),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when sub is non-numeric', async () => {
      mockAuthService.verifyAccessToken.mockResolvedValue({
        sub: 'abc',
        exp: 9999999999,
      });
      const res = mockRes() as unknown as never;
      await expect(
        controller.createSession({ access_token: 'tok' }, res),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('uses 1-hour fallback when token has no exp', async () => {
      mockAuthService.verifyAccessToken.mockResolvedValue({ sub: '42' }); // no exp
      mockAuthService.resolveOrProvisionUser.mockResolvedValue({
        userId: 7,
        roles: [],
        permissions: [],
      });
      const res = mockRes();
      await controller.createSession({ access_token: 'tok' }, res);
      expect(res.cookie).toHaveBeenCalledWith(
        'uw_access_token',
        'tok',
        expect.objectContaining({ maxAge: 3_600_000 }),
      );
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the cookie and returns 204', () => {
      const res = mockRes();
      controller.logout(res);
      expect(res.cookie).toHaveBeenCalledWith(
        'uw_access_token',
        '',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          maxAge: 0,
        }),
      );
    });
  });

  describe('GET /auth/me', () => {
    it('returns user profile', () => {
      const user: AuthenticatedUser = {
        sub: '42',
        userId: 7,
        tenantId: null,
        tenantName: null,
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        roles: ['admin'],
        permissions: ['user:read'],
      };
      expect(controller.getProfile(user)).toEqual({
        userId: 7,
        sub: '42',
        tenantId: null,
        tenantName: null,
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        roles: ['admin'],
        permissions: ['user:read'],
      });
    });
  });
});
