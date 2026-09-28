import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductBatchesService } from './product-batches.service';

const RAW_BATCH = {
  batchId: 1,
  tenantId: 1,
  productId: 1,
  batchNumber: 'BN-001',
  expiryDate: new Date('2030-01-01'),
  quantityReceived: 100,
  quantityRemaining: 100,
  receivedAt: new Date(2026, 0, 1, 9, 0),
  createdAt: new Date(2026, 0, 1, 9, 0),
  updatedAt: new Date(2026, 0, 1, 9, 0),
};

const mockPrisma = {
  product: { findFirst: jest.fn() },
  productBatch: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const makeService = () => new ProductBatchesService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();

  mockPrisma.product.findFirst.mockResolvedValue({ productId: 1 });
  mockPrisma.productBatch.create.mockResolvedValue(RAW_BATCH);
  mockPrisma.productBatch.findMany.mockResolvedValue([RAW_BATCH]);
  mockPrisma.productBatch.count.mockResolvedValue(1);
});

describe('ProductBatchesService', () => {
  describe('create', () => {
    it('creates a batch with quantityRemaining equal to quantityReceived', async () => {
      const result = await makeService().create(1, 1, {
        batchNumber: 'BN-001',
        expiryDate: '2030-01-01',
        quantityReceived: 100,
      });

      expect(mockPrisma.productBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 1,
            productId: 1,
            quantityReceived: 100,
            quantityRemaining: 100,
          }) as never,
        }),
      );
      expect(result.quantityRemaining).toBe(100);
    });

    it('throws NotFoundException when the product does not belong to the tenant', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(
        makeService().create(1, 999, {
          batchNumber: 'BN-001',
          expiryDate: '2030-01-01',
          quantityReceived: 100,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.productBatch.create).not.toHaveBeenCalled();
    });

    it('rejects an expiryDate in the past with BadRequestException (AC-3)', async () => {
      await expect(
        makeService().create(1, 1, {
          batchNumber: 'BN-001',
          expiryDate: '2000-01-01',
          quantityReceived: 100,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.productBatch.create).not.toHaveBeenCalled();
    });

    it('accepts an expiryDate of exactly today (boundary case left open by the PRD)', async () => {
      const todayUtc = new Date().toISOString().split('T')[0];

      await expect(
        makeService().create(1, 1, {
          batchNumber: 'BN-001',
          expiryDate: todayUtc,
          quantityReceived: 100,
        }),
      ).resolves.toBeDefined();
      expect(mockPrisma.productBatch.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAllForProduct', () => {
    it('orders soonest-expiry-first', async () => {
      await makeService().findAllForProduct(1, 1, { page: 1, per_page: 25 });

      expect(mockPrisma.productBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 1, productId: 1 },
          orderBy: { expiryDate: 'asc' },
        }),
      );
    });

    it('returns an empty page for a product with no batches yet', async () => {
      mockPrisma.productBatch.findMany.mockResolvedValue([]);
      mockPrisma.productBatch.count.mockResolvedValue(0);

      const result = await makeService().findAllForProduct(1, 1, {});

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });

    it('throws NotFoundException when the product does not belong to the tenant', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(makeService().findAllForProduct(1, 999, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
