import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CategoriesService } from './categories.service';

const RAW_CATEGORY = {
  categoryId: 1,
  tenantId: 1,
  name: 'Tablets',
  isActive: true,
  createdAt: new Date(2026, 0, 1, 9, 0),
  updatedAt: new Date(2026, 0, 2, 9, 0),
};

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '0.0.0',
    meta: { target },
  });
}

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
  category: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const makeService = () => new CategoriesService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();

  mockPrisma.tenant.findUnique.mockResolvedValue({ tenantId: 1 });
  mockPrisma.category.create.mockResolvedValue(RAW_CATEGORY);
  mockPrisma.category.findFirst.mockResolvedValue(null);
  mockPrisma.category.findMany.mockResolvedValue([RAW_CATEGORY]);
  mockPrisma.category.count.mockResolvedValue(1);
});

describe('CategoriesService', () => {
  describe('create', () => {
    it('creates a category scoped to the given tenant', async () => {
      const result = await makeService().create(1, { name: 'Tablets' });

      expect(mockPrisma.category.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { tenantId: 1, name: 'Tablets' },
        }),
      );
      expect(result.tenantId).toBe(1);
      expect(result.name).toBe('Tablets');
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        makeService().create(999, { name: 'Tablets' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.category.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when a category with that name (case-insensitive) already exists', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(RAW_CATEGORY);

      await expect(
        makeService().create(1, { name: 'tablets' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.category.create).not.toHaveBeenCalled();
    });

    it('checks name availability case-insensitively', async () => {
      await makeService().create(1, { name: 'Tablets' });

      expect(mockPrisma.category.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 1,
            name: { equals: 'Tablets', mode: 'insensitive' },
          },
        }),
      );
    });

    it('converts a race-condition P2002 from the DB into ConflictException', async () => {
      mockPrisma.category.create.mockRejectedValue(
        p2002(['tenant_id', 'name']),
      );

      await expect(
        makeService().create(1, { name: 'Tablets' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('returns mapped data scoped to the tenant with pagination meta', async () => {
      const result = await makeService().findAll(1, { page: 1, per_page: 25 });

      expect(mockPrisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 1 } }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        per_page: 25,
        total_pages: 1,
      });
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(makeService().findAll(999, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOrCreateByName', () => {
    it('returns the existing category when one already matches (case-insensitive)', async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ categoryId: 1 });

      const result = await makeService().findOrCreateByName(1, 'tablets');

      expect(result).toEqual({ categoryId: 1 });
      expect(mockPrisma.category.create).not.toHaveBeenCalled();
    });

    it('creates a new category when none exists yet', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(null);
      mockPrisma.category.create.mockResolvedValue({ categoryId: 5 });

      const result = await makeService().findOrCreateByName(1, 'Syrups');

      expect(mockPrisma.category.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tenantId: 1, name: 'Syrups' } }),
      );
      expect(result).toEqual({ categoryId: 5 });
    });

    it('falls back to the race winner on a concurrent-create P2002', async () => {
      mockPrisma.category.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ categoryId: 9 });
      mockPrisma.category.create.mockRejectedValue(
        p2002(['tenant_id', 'name']),
      );

      const result = await makeService().findOrCreateByName(1, 'Syrups');

      expect(result).toEqual({ categoryId: 9 });
    });
  });
});
