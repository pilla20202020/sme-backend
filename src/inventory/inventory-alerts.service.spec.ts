import { InventoryAlertsService } from './inventory-alerts.service';

const mockPrisma = {
  product: { findMany: jest.fn() },
  productBatch: { findMany: jest.fn(), count: jest.fn() },
};

const makeService = () => new InventoryAlertsService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('InventoryAlertsService', () => {
  describe('getLowStock', () => {
    it('only queries products with a non-null reorderThreshold', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);

      await makeService().getLowStock(1, { page: 1, per_page: 25 });

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 1, reorderThreshold: { not: null } },
        }),
      );
    });

    it('excludes a product exactly at threshold (strictly less than, not <=)', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        {
          productId: 1,
          name: 'At Threshold',
          sku: 'SKU1',
          reorderThreshold: 10,
          batches: [{ quantityRemaining: 10 }],
        },
      ]);

      const result = await makeService().getLowStock(1, {
        page: 1,
        per_page: 25,
      });

      expect(result.data).toHaveLength(0);
    });

    it('includes shortages sorted worst-first (most negative totalOnHand - reorderThreshold)', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        {
          productId: 1,
          name: 'Mild Shortage',
          sku: 'SKU1',
          reorderThreshold: 10,
          batches: [{ quantityRemaining: 8 }], // -2
        },
        {
          productId: 2,
          name: 'Severe Shortage',
          sku: 'SKU2',
          reorderThreshold: 20,
          batches: [{ quantityRemaining: 1 }], // -19
        },
        {
          productId: 3,
          name: 'Not Short',
          sku: 'SKU3',
          reorderThreshold: 5,
          batches: [{ quantityRemaining: 5 }], // 0, excluded
        },
      ]);

      const result = await makeService().getLowStock(1, {
        page: 1,
        per_page: 25,
      });

      expect(result.data.map((d) => d.productId)).toEqual([2, 1]);
      expect(result.meta.total).toBe(2);
    });

    it('sums quantityRemaining across all of a product batches for totalOnHand', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        {
          productId: 1,
          name: 'Multi Batch',
          sku: null,
          reorderThreshold: 10,
          batches: [{ quantityRemaining: 3 }, { quantityRemaining: 4 }],
        },
      ]);

      const result = await makeService().getLowStock(1, {
        page: 1,
        per_page: 25,
      });

      expect(result.data[0].totalOnHand).toBe(7);
    });
  });

  describe('getNearExpiry', () => {
    it('filters to quantityRemaining > 0 and expiryDate <= today + withinDays', async () => {
      mockPrisma.productBatch.findMany.mockResolvedValue([]);
      mockPrisma.productBatch.count.mockResolvedValue(0);

      await makeService().getNearExpiry(1, 30, { page: 1, per_page: 25 });

      expect(mockPrisma.productBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 1,
            quantityRemaining: { gt: 0 },
            expiryDate: { lte: expect.any(Date) as Date },
          },
          orderBy: { expiryDate: 'asc' },
        }),
      );
    });

    it('includes an already-expired batch with a negative daysUntilExpiry', async () => {
      // Must be a true day-boundary value (UTC midnight, one day back), not
      // "now minus 24h" — the service compares against startOfTodayUtc()
      // (midnight), so "now minus 24h" is only >12h before midnight for half
      // of any given day and rounds to -0 (which fails toBeLessThan(0)) for
      // the other half, making the test's pass/fail depend on what time of
      // day it happens to run.
      const now = new Date();
      const yesterday = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
      );

      mockPrisma.productBatch.findMany.mockResolvedValue([
        {
          batchId: 1,
          productId: 5,
          product: { name: 'Expired Product' },
          batchNumber: 'B-OLD',
          expiryDate: yesterday,
          quantityRemaining: 3,
        },
      ]);
      mockPrisma.productBatch.count.mockResolvedValue(1);

      const result = await makeService().getNearExpiry(1, 30, {
        page: 1,
        per_page: 25,
      });

      expect(result.data[0].daysUntilExpiry).toBeLessThan(0);
      expect(result.data[0].productName).toBe('Expired Product');
    });
  });
});
