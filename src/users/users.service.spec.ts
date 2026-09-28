import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';

// Fixtures

const RAW_USER = {
  userId: 1,
  ssoUserId: 100,
  tenantId: null,
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  phone: null,
  isActive: true,
  lastLoggedInAt: new Date(2026, 5, 30, 15, 45),
  createdAt: new Date(2026, 0, 1, 9, 0),
  updatedAt: new Date(2026, 0, 2, 9, 0),
};

const RAW_INVITED_USER = {
  userId: 2,
  ssoUserId: null,
  tenantId: 1,
  email: 'manager@example.com',
  firstName: 'Manager',
  lastName: 'Person',
  phone: null,
  isActive: true,
  lastLoggedInAt: null,
  createdAt: new Date(2026, 0, 3, 9, 0),
  updatedAt: new Date(2026, 0, 3, 9, 0),
};

// Mocks

const mockPrisma = {
  user: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
  },
  role: {
    findFirst: jest.fn(),
  },
};

const makeService = () => new UsersService(mockPrisma as never);

// Shared setup

beforeEach(() => {
  jest.clearAllMocks();

  mockPrisma.user.create.mockResolvedValue(RAW_USER);
  mockPrisma.user.findMany.mockResolvedValue([RAW_USER]);
  mockPrisma.user.count.mockResolvedValue(1);
  mockPrisma.tenant.findUnique.mockResolvedValue({ tenantId: 1 });
  mockPrisma.role.findFirst.mockResolvedValue({
    roleId: 3,
    roleName: 'manager',
  });
});

// Tests

describe('UsersService', () => {
  it('should be defined', () => {
    expect(makeService()).toBeDefined();
  });

  describe('create', () => {
    it('formats date fields as MM/DD/YYYY hh:mm AM/PM', async () => {
      const result = await makeService().create({} as never);

      expect(result.createdAt).toBe('01/01/2026 09:00 AM');
      expect(result.updatedAt).toBe('01/02/2026 09:00 AM');
      expect(result.lastLoggedInAt).toBe('06/30/2026 03:45 PM');
    });

    it('returns null lastLoggedInAt when the user has never logged in', async () => {
      mockPrisma.user.create.mockResolvedValue({
        ...RAW_USER,
        lastLoggedInAt: null,
      });

      const result = await makeService().create({} as never);

      expect(result.lastLoggedInAt).toBeNull();
    });

    it('throws ConflictException when the email or SSO ID already exists', async () => {
      mockPrisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        }),
      );

      await expect(makeService().create({} as never)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows unrelated errors', async () => {
      mockPrisma.user.create.mockRejectedValue(new Error('Connection lost'));

      await expect(makeService().create({} as never)).rejects.toThrow(
        'Connection lost',
      );
    });
  });

  describe('findAll', () => {
    it('returns mapped data with pagination meta', async () => {
      const result = await makeService().findAll({ page: 1, per_page: 25 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].email).toBe('jane@example.com');
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        per_page: 25,
        total_pages: 1,
      });
    });

    it('defaults to page 1 and per_page 25 when not provided', async () => {
      await makeService().findAll({});

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 25 }),
      );
    });

    it('computes skip from page and per_page', async () => {
      await makeService().findAll({ page: 3, per_page: 10 });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('sends an empty lastName instead of the legacy "-" placeholder', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { ...RAW_USER, firstName: 'Bishal', lastName: '-' },
      ]);

      const result = await makeService().findAll({});

      expect(result.data[0].lastName).toBe('');
    });

    it('leaves a real lastName untouched', async () => {
      const result = await makeService().findAll({});

      expect(result.data[0].lastName).toBe('Doe');
    });
  });

  describe('inviteToTenant', () => {
    beforeEach(() => {
      mockPrisma.user.create.mockResolvedValue(RAW_INVITED_USER);
    });

    it('creates a user scoped to the tenant with no ssoUserId and the given role', async () => {
      const result = await makeService().inviteToTenant(1, {
        email: 'manager@example.com',
        firstName: 'Manager',
        lastName: 'Person',
        roleName: 'manager',
        password: 'Sup3rSecret!',
      });

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 1,
            email: 'manager@example.com',
            roles: { create: { roleId: 3 } },
          }) as never,
        }),
      );
      expect(result.ssoUserId).toBeNull();
      expect(result.tenantId).toBe(1);
      expect(result.roleName).toBe('manager');
    });

    it('stores a bcrypt hash of the password, never the plaintext', async () => {
      await makeService().inviteToTenant(1, {
        email: 'manager@example.com',
        firstName: 'Manager',
        lastName: 'Person',
        roleName: 'manager',
        password: 'Sup3rSecret!',
      });

      const createCall = (
        mockPrisma.user.create.mock.calls as [
          { data: { passwordHash: string } },
        ][]
      )[0][0];
      expect(createCall.data.passwordHash).toBeDefined();
      expect(createCall.data.passwordHash).not.toBe('Sup3rSecret!');
      await expect(
        bcrypt.compare('Sup3rSecret!', createCall.data.passwordHash),
      ).resolves.toBe(true);
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        makeService().inviteToTenant(999, {
          email: 'x@example.com',
          firstName: 'X',
          lastName: 'Y',
          roleName: 'manager',
          password: 'Sup3rSecret!',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the role is not configured', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(
        makeService().inviteToTenant(1, {
          email: 'x@example.com',
          firstName: 'X',
          lastName: 'Y',
          roleName: 'manager',
          password: 'Sup3rSecret!',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the email is already in use', async () => {
      mockPrisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        }),
      );

      await expect(
        makeService().inviteToTenant(1, {
          email: 'manager@example.com',
          firstName: 'Manager',
          lastName: 'Person',
          roleName: 'manager',
          password: 'Sup3rSecret!',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAllByTenant', () => {
    it('returns only users scoped to the given tenant', async () => {
      mockPrisma.user.findMany.mockResolvedValue([RAW_INVITED_USER]);

      const result = await makeService().findAllByTenant(1, {});

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 1 } }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].tenantId).toBe(1);
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(makeService().findAllByTenant(999, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
