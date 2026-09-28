import { NotFoundException } from '@nestjs/common';
import { Vertical } from '@prisma/client';
import { TenantsService } from './tenants.service';

// Fixtures

const RAW_TENANT = {
  tenantId: 1,
  name: 'Sample Pharmacy Pvt. Ltd.',
  vertical: Vertical.pharmacy,
  currency: 'NPR',
  batchExpiryTrackingEnabled: true,
  isActive: true,
  createdAt: new Date(2026, 0, 1, 9, 0),
  updatedAt: new Date(2026, 0, 2, 9, 0),
};

const OTHER_TENANT = {
  tenantId: 2,
  name: 'Another Pharmacy',
  vertical: Vertical.pharmacy,
  currency: 'NPR',
  batchExpiryTrackingEnabled: true,
  isActive: true,
  createdAt: new Date(2026, 0, 3, 9, 0),
  updatedAt: new Date(2026, 0, 3, 9, 0),
};

// Mocks

const mockPrisma = {
  tenant: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const makeService = () => new TenantsService(mockPrisma as never);

// Shared setup

beforeEach(() => {
  jest.clearAllMocks();

  mockPrisma.tenant.create.mockResolvedValue(RAW_TENANT);
  mockPrisma.tenant.findUnique.mockResolvedValue(RAW_TENANT);
  mockPrisma.tenant.findMany.mockResolvedValue([RAW_TENANT]);
  mockPrisma.tenant.count.mockResolvedValue(1);
});

// Tests

describe('TenantsService', () => {
  it('should be defined', () => {
    expect(makeService()).toBeDefined();
  });

  describe('register', () => {
    it('creates an isolated tenant record from the given business details', async () => {
      const result = await makeService().register({
        name: 'Sample Pharmacy Pvt. Ltd.',
      });

      expect(mockPrisma.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Sample Pharmacy Pvt. Ltd.',
          }) as never,
        }),
      );
      expect(result.tenantId).toBe(1);
      expect(result.name).toBe('Sample Pharmacy Pvt. Ltd.');
    });

    it('defaults vertical to pharmacy when not provided', async () => {
      await makeService().register({ name: 'Unspecified Vertical Co' });

      expect(mockPrisma.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vertical: Vertical.pharmacy,
          }) as never,
        }),
      );
    });

    it('defaults currency to NPR when not provided', async () => {
      await makeService().register({ name: 'No Currency Specified' });

      expect(mockPrisma.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currency: 'NPR' }) as never,
        }),
      );
    });

    it('enables batch/expiry tracking by default for the pharmacy vertical', async () => {
      await makeService().register({
        name: 'Pharmacy Co',
        vertical: Vertical.pharmacy,
      });

      expect(mockPrisma.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            batchExpiryTrackingEnabled: true,
          }) as never,
        }),
      );
    });

    it('disables batch/expiry tracking for a non-pharmacy vertical', async () => {
      await makeService().register({
        name: 'Hardware Co',
        vertical: Vertical.hardware,
      });

      expect(mockPrisma.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            batchExpiryTrackingEnabled: false,
          }) as never,
        }),
      );
    });

    it('respects an explicitly provided currency', async () => {
      await makeService().register({
        name: 'USD Pharmacy',
        currency: 'USD',
      });

      expect(mockPrisma.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currency: 'USD' }) as never,
        }),
      );
    });
  });

  describe('findById', () => {
    it('returns only the requested tenant, never another tenant’s record', async () => {
      mockPrisma.tenant.findUnique.mockImplementation(
        ({ where }: { where: { tenantId: number } }) =>
          Promise.resolve(
            [RAW_TENANT, OTHER_TENANT].find(
              (t) => t.tenantId === where.tenantId,
            ) ?? null,
          ),
      );

      const tenantOne = await makeService().findById(1);
      const tenantTwo = await makeService().findById(2);

      expect(tenantOne.tenantId).toBe(1);
      expect(tenantOne.name).toBe('Sample Pharmacy Pvt. Ltd.');
      expect(tenantTwo.tenantId).toBe(2);
      expect(tenantTwo.name).toBe('Another Pharmacy');
      expect(tenantOne.name).not.toBe(tenantTwo.name);
    });

    it('throws NotFoundException for a tenant ID that does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(makeService().findById(999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('returns mapped data with pagination meta', async () => {
      const result = await makeService().findAll({ page: 1, per_page: 25 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Sample Pharmacy Pvt. Ltd.');
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        per_page: 25,
        total_pages: 1,
      });
    });

    it('defaults to page 1 and per_page 25 when not provided', async () => {
      await makeService().findAll({});

      expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 25 }),
      );
    });

    it('computes skip from page and per_page', async () => {
      await makeService().findAll({ page: 3, per_page: 10 });

      expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });
});
