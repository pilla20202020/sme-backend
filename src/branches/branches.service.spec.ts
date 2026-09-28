import { NotFoundException } from '@nestjs/common';
import { BranchesService } from './branches.service';

// Fixtures

const RAW_BRANCH = {
  branchId: 1,
  tenantId: 1,
  name: 'Downtown Branch',
  address: '123 Main St',
  isActive: true,
  createdAt: new Date(2026, 0, 1, 9, 0),
  updatedAt: new Date(2026, 0, 2, 9, 0),
};

const OTHER_TENANT_BRANCH = {
  branchId: 2,
  tenantId: 2,
  name: 'A Different Tenant’s Branch',
  address: null,
  isActive: true,
  createdAt: new Date(2026, 0, 3, 9, 0),
  updatedAt: new Date(2026, 0, 3, 9, 0),
};

// Mocks

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
  branch: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const makeService = () => new BranchesService(mockPrisma as never);

// Shared setup

beforeEach(() => {
  jest.clearAllMocks();

  mockPrisma.tenant.findUnique.mockResolvedValue({ tenantId: 1 });
  mockPrisma.branch.create.mockResolvedValue(RAW_BRANCH);
  mockPrisma.branch.findFirst.mockResolvedValue(RAW_BRANCH);
  mockPrisma.branch.findMany.mockResolvedValue([RAW_BRANCH]);
  mockPrisma.branch.count.mockResolvedValue(1);
});

describe('BranchesService', () => {
  it('should be defined', () => {
    expect(makeService()).toBeDefined();
  });

  describe('create', () => {
    it('creates a branch scoped to the given tenant', async () => {
      const result = await makeService().create(1, {
        name: 'Downtown Branch',
        address: '123 Main St',
      });

      expect(mockPrisma.branch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 1,
            name: 'Downtown Branch',
            address: '123 Main St',
          }) as never,
        }),
      );
      expect(result.tenantId).toBe(1);
      expect(result.name).toBe('Downtown Branch');
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        makeService().create(999, { name: 'Ghost Branch' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.branch.create).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns the branch when it belongs to the given tenant', async () => {
      const result = await makeService().findById(1, 1);

      expect(mockPrisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { branchId: 1, tenantId: 1 },
        }),
      );
      expect(result.branchId).toBe(1);
    });

    it('throws NotFoundException when the branch belongs to a different tenant', async () => {
      // findFirst is called with {branchId, tenantId} — a branch that exists
      // under a different tenant simply never matches, so Prisma returns null.
      mockPrisma.branch.findFirst.mockImplementation(
        ({ where }: { where: { branchId: number; tenantId: number } }) =>
          Promise.resolve(
            [RAW_BRANCH, OTHER_TENANT_BRANCH].find(
              (b) =>
                b.branchId === where.branchId && b.tenantId === where.tenantId,
            ) ?? null,
          ),
      );

      await expect(makeService().findById(1, 2)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for a branch ID that does not exist at all', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue(null);

      await expect(makeService().findById(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('returns mapped data scoped to the tenant with pagination meta', async () => {
      const result = await makeService().findAll(1, { page: 1, per_page: 25 });

      expect(mockPrisma.branch.findMany).toHaveBeenCalledWith(
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

    it('computes skip from page and per_page', async () => {
      await makeService().findAll(1, { page: 3, per_page: 10 });

      expect(mockPrisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });
});
