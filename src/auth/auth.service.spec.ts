import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveUser', () => {
    it('returns null when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await service.resolveUser(42);
      expect(result).toBeNull();
    });

    it('returns null when user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        userId: 1,
        isActive: false,
        roles: [],
      });
      const result = await service.resolveUser(42);
      expect(result).toBeNull();
    });

    it('returns resolved user with flattened roles and permissions', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        userId: 7,
        isActive: true,
        roles: [
          {
            role: {
              roleName: 'admin',
              permissions: [
                { permission: { name: 'user:read' } },
                { permission: { name: 'user:create' } },
              ],
            },
          },
        ],
      });
      const result = await service.resolveUser(42);
      expect(result).toEqual({
        userId: 7,
        tenantName: null,
        roles: ['admin'],
        permissions: ['user:read', 'user:create'],
      });
    });

    it('deduplicates permissions from multiple roles', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        userId: 3,
        isActive: true,
        roles: [
          {
            role: {
              roleName: 'admin',
              permissions: [{ permission: { name: 'user:read' } }],
            },
          },
          {
            role: {
              roleName: 'editor',
              permissions: [{ permission: { name: 'user:read' } }],
            },
          },
        ],
      });
      const result = await service.resolveUser(3);
      expect(result?.permissions).toEqual(['user:read']);
    });
  });

  describe('resolveOrProvisionUser', () => {
    const mockProvisionPrisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
      role: { findFirst: jest.fn() },
    };

    let provisionService: AuthService;

    beforeEach(async () => {
      jest.clearAllMocks();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) =>
                key === 'SSO_APP_INIT_URI'
                  ? 'https://sso.example.com/app-init'
                  : undefined,
              ),
            },
          },
          { provide: PrismaService, useValue: mockProvisionPrisma },
        ],
      }).compile();
      provisionService = module.get<AuthService>(AuthService);

      mockProvisionPrisma.role.findFirst.mockResolvedValue({
        roleId: 1,
        roleName: 'viewer',
      });
      mockProvisionPrisma.user.create.mockResolvedValue({});
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'success',
            user: {
              id: 55,
              email: 'bishal@example.com',
              name: 'Bishal',
              phone: null,
              user_type: 'VIEWER',
            },
          }),
      });
    });

    it('stores an empty lastName instead of a "-" placeholder when the SSO user has no surname', async () => {
      mockProvisionPrisma.user.findUnique
        .mockResolvedValueOnce(null) // no existing user yet
        .mockResolvedValueOnce({ userId: 55, isActive: true, roles: [] }); // post-create lookup

      await provisionService.resolveOrProvisionUser(55, 'token');

      expect(mockProvisionPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstName: 'Bishal',
            lastName: '',
          }) as never,
        }),
      );
    });

    it('splits a multi-word SSO name into first and last name', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'success',
            user: {
              id: 56,
              email: 'aashish@example.com',
              name: 'Aashish Katwal',
              phone: null,
              user_type: 'VIEWER',
            },
          }),
      });
      mockProvisionPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 56, isActive: true, roles: [] });

      await provisionService.resolveOrProvisionUser(56, 'token');

      expect(mockProvisionPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstName: 'Aashish',
            lastName: 'Katwal',
          }) as never,
        }),
      );
    });

    it('fails loudly with a specific error instead of a silent 404 when the P2002 conflict is on email, not ssoUserId', async () => {
      mockProvisionPrisma.user.findUnique.mockResolvedValueOnce(null); // no existing SSO user yet
      mockProvisionPrisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
          meta: { target: ['email'] },
        }),
      );

      await expect(
        provisionService.resolveOrProvisionUser(55, 'token'),
      ).rejects.toThrow(
        'Unable to provision user — email is already associated with a different account',
      );
    });

    it('still treats a P2002 on sso_user_id as a benign concurrent-first-login race', async () => {
      mockProvisionPrisma.user.findUnique
        .mockResolvedValueOnce(null) // initial lookup: not found
        .mockResolvedValueOnce({ userId: 55, isActive: true, roles: [] }); // post-race lookup
      mockProvisionPrisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
          meta: { target: ['sso_user_id'] },
        }),
      );

      const result = await provisionService.resolveOrProvisionUser(55, 'token');
      expect(result?.userId).toBe(55);
    });
  });

  describe('verifyLocalToken', () => {
    it('accepts a token with the local tokenType claim', () => {
      const token = jwt.sign(
        { sub: '9', tokenType: 'local' },
        'dev-only-insecure-local-secret',
        { algorithm: 'HS256', expiresIn: 3600 },
      );
      const payload = service.verifyLocalToken(token);
      expect(payload.sub).toBe('9');
    });

    it('rejects a token missing the local tokenType claim', () => {
      const token = jwt.sign({ sub: '9' }, 'dev-only-insecure-local-secret', {
        algorithm: 'HS256',
        expiresIn: 3600,
      });
      expect(() => service.verifyLocalToken(token)).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token signed with the wrong secret', () => {
      const token = jwt.sign(
        { sub: '9', tokenType: 'local' },
        'a-completely-different-secret',
        { algorithm: 'HS256', expiresIn: 3600 },
      );
      expect(() => service.verifyLocalToken(token)).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired token', () => {
      const token = jwt.sign(
        { sub: '9', tokenType: 'local' },
        'dev-only-insecure-local-secret',
        { algorithm: 'HS256', expiresIn: -1 },
      );
      expect(() => service.verifyLocalToken(token)).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('login', () => {
    it('returns null when no user has that email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await service.login('nobody@example.com', 'whatever');
      expect(result).toBeNull();
    });

    it('returns null for an SSO-only user with no passwordHash', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        userId: 1,
        passwordHash: null,
        isActive: true,
      });
      const result = await service.login('admin@example.com', 'whatever');
      expect(result).toBeNull();
    });

    it('returns null for an inactive user', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      mockPrisma.user.findUnique.mockResolvedValue({
        userId: 1,
        passwordHash,
        isActive: false,
      });
      const result = await service.login(
        'staff@example.com',
        'correct-password',
      );
      expect(result).toBeNull();
    });

    it('returns null when the password does not match', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      mockPrisma.user.findUnique.mockResolvedValue({
        userId: 1,
        passwordHash,
        isActive: true,
        tenantId: 1,
        email: 'staff@example.com',
        firstName: 'Staff',
        lastName: 'Member',
        roles: [],
      });
      const result = await service.login('staff@example.com', 'wrong-password');
      expect(result).toBeNull();
    });

    it('returns a signed token and the resolved user on valid credentials', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          userId: 1,
          passwordHash,
          isActive: true,
        })
        .mockResolvedValueOnce({
          userId: 1,
          tenantId: 1,
          email: 'staff@example.com',
          firstName: 'Staff',
          lastName: 'Member',
          isActive: true,
          roles: [
            {
              role: {
                roleName: 'manager',
                permissions: [{ permission: { name: 'branch:read' } }],
              },
            },
          ],
        });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.login(
        'staff@example.com',
        'correct-password',
      );

      expect(result).not.toBeNull();
      expect(result?.user.userId).toBe(1);
      expect(result?.user.tenantId).toBe(1);
      expect(result?.user.roles).toEqual(['manager']);

      const decoded = jwt.decode(result!.token) as {
        tokenType?: string;
        sub?: string;
      };
      expect(decoded.tokenType).toBe('local');
      expect(decoded.sub).toBe('1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 1 } }),
      );
    });
  });
});
