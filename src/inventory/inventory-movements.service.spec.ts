import { ConflictException, NotFoundException } from '@nestjs/common';
import { InventoryMovementsService } from './inventory-movements.service';

const RAW_PRODUCT = { productId: 5 };

const RAW_BATCH = {
  batchId: 55,
  tenantId: 1,
  productId: 5,
  batchNumber: 'B1',
  quantityRemaining: 10,
};

function rawMovement(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    movementId: BigInt(1),
    tenantId: 1,
    productId: 5,
    productBatchId: 55,
    movementType: 'adjustment',
    quantityDelta: -3,
    reason: 'Damaged in transit',
    referenceType: 'InventoryAdjustment',
    referenceId: null,
    actorId: 7,
    occurredAt: new Date(2026, 0, 5, 9, 0),
    ...overrides,
  };
}

const mockTx = {
  productBatch: {
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    updateMany: jest.fn(),
  },
  inventoryMovement: { create: jest.fn(), update: jest.fn() },
};

const mockPrisma = {
  product: { findFirst: jest.fn() },
  productBatch: { findMany: jest.fn() },
  inventoryMovement: { findMany: jest.fn(), count: jest.fn() },
  $transaction: jest.fn((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
};

const makeService = () => new InventoryMovementsService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.product.findFirst.mockResolvedValue(RAW_PRODUCT);
  mockPrisma.$transaction.mockImplementation(
    (cb: (tx: typeof mockTx) => unknown) => cb(mockTx),
  );
});

describe('InventoryMovementsService', () => {
  describe('findAll', () => {
    it('paginates and filters by tenant, applying optional productId/movementType/date filters', async () => {
      mockPrisma.inventoryMovement.findMany.mockResolvedValue([rawMovement()]);
      mockPrisma.inventoryMovement.count.mockResolvedValue(1);

      const result = await makeService().findAll(1, {
        page: 1,
        per_page: 25,
        productId: 5,
        movementType: 'adjustment',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
      });

      expect(mockPrisma.inventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 1,
            productId: 5,
            movementType: 'adjustment',
            occurredAt: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-12-31'),
            },
          },
          orderBy: { occurredAt: 'desc' },
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].movementId).toBe('1');
    });
  });

  describe('findAllForProduct', () => {
    it('throws NotFoundException when the product does not belong to the tenant', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(
        makeService().findAllForProduct(1, 999, { page: 1, per_page: 25 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('scopes the where clause to tenantId + productId from the path', async () => {
      mockPrisma.inventoryMovement.findMany.mockResolvedValue([]);
      mockPrisma.inventoryMovement.count.mockResolvedValue(0);

      await makeService().findAllForProduct(1, 5, { page: 1, per_page: 25 });

      expect(mockPrisma.inventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 1, productId: 5 } }),
      );
    });
  });

  describe('getOnHand', () => {
    it('throws NotFoundException when the product does not belong to the tenant', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(makeService().getOnHand(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('sums quantityRemaining across all of the product batches', async () => {
      mockPrisma.productBatch.findMany.mockResolvedValue([
        {
          ...RAW_BATCH,
          batchId: 1,
          quantityRemaining: 4,
          expiryDate: new Date('2099-01-01'),
        },
        {
          ...RAW_BATCH,
          batchId: 2,
          quantityRemaining: 6,
          expiryDate: new Date('2099-06-01'),
        },
      ]);

      const result = await makeService().getOnHand(1, 5);

      expect(result.totalOnHand).toBe(10);
      expect(result.batches).toHaveLength(2);
    });

    it('returns totalOnHand 0 and an empty batches array for a product with no batches yet', async () => {
      mockPrisma.productBatch.findMany.mockResolvedValue([]);

      const result = await makeService().getOnHand(1, 5);

      expect(result).toEqual({ productId: 5, totalOnHand: 0, batches: [] });
    });
  });

  describe('createAdjustment', () => {
    it('increments quantityRemaining via one atomic guarded updateMany and records an adjustment movement whose referenceId is its own movementId (STORY-016)', async () => {
      mockTx.productBatch.updateMany.mockResolvedValue({ count: 1 });
      mockTx.productBatch.findFirstOrThrow.mockResolvedValue({
        ...RAW_BATCH,
        quantityRemaining: 15,
      });
      mockTx.inventoryMovement.create.mockResolvedValue(
        rawMovement({ quantityDelta: 5, referenceId: null }),
      );
      mockTx.inventoryMovement.update.mockResolvedValue(
        rawMovement({ quantityDelta: 5, referenceId: 1 }),
      );

      const result = await makeService().createAdjustment(
        1,
        5,
        { productBatchId: 55, quantityDelta: 5, reason: 'Found extra stock' },
        7,
      );

      expect(mockTx.productBatch.updateMany).toHaveBeenCalledWith({
        where: {
          batchId: 55,
          tenantId: 1,
          productId: 5,
          quantityRemaining: { gte: -5 },
        },
        data: { quantityRemaining: { increment: 5 } },
      });
      expect(mockTx.inventoryMovement.create).toHaveBeenCalledWith({
        data: {
          tenantId: 1,
          productId: 5,
          productBatchId: 55,
          movementType: 'adjustment',
          quantityDelta: 5,
          reason: 'Found extra stock',
          referenceType: 'InventoryAdjustment',
          actorId: 7,
        },
      });
      expect(mockTx.inventoryMovement.update).toHaveBeenCalledWith({
        where: { movementId: BigInt(1) },
        data: { referenceId: 1 },
      });
      expect(result.quantityRemaining).toBe(15);
      expect(result.movement.referenceId).toBe(1);
    });

    it('throws NotFoundException when the batch does not belong to this tenant+product, writing nothing', async () => {
      mockTx.productBatch.updateMany.mockResolvedValue({ count: 0 });
      mockTx.productBatch.findFirst.mockResolvedValue(null);

      await expect(
        makeService().createAdjustment(1, 5, {
          productBatchId: 999,
          quantityDelta: -1,
          reason: 'Count correction',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockTx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the delta would drive quantityRemaining below zero, writing nothing (guard fails inside the atomic updateMany, not a prior in-app read)', async () => {
      mockTx.productBatch.updateMany.mockResolvedValue({ count: 0 });
      mockTx.productBatch.findFirst.mockResolvedValue({
        ...RAW_BATCH,
        quantityRemaining: 2,
      });

      await expect(
        makeService().createAdjustment(1, 5, {
          productBatchId: 55,
          quantityDelta: -5,
          reason: 'Damage',
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockTx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('never rejects two well-formed adjustments as if only the DB decides atomically (regression for the lost-update race QA caught): a second concurrent adjustment sees updateMany return count 0 once the guard genuinely fails, rather than the app re-deriving staleness itself', async () => {
      // Simulates what a second concurrent request observes once Postgres's
      // own WHERE-clause re-evaluation (not app code) has already rejected it
      // — the service must trust updateMany's count, not a value it read
      // earlier in the same call.
      mockTx.productBatch.updateMany.mockResolvedValue({ count: 0 });
      mockTx.productBatch.findFirst.mockResolvedValue({
        ...RAW_BATCH,
        quantityRemaining: 2, // already decremented by the "other" concurrent adjustment
      });

      await expect(
        makeService().createAdjustment(1, 5, {
          productBatchId: 55,
          quantityDelta: -8,
          reason: 'Concurrent count correction',
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockTx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('allows a negative delta that exactly zeroes out the batch (boundary: not below zero)', async () => {
      mockTx.productBatch.updateMany.mockResolvedValue({ count: 1 });
      mockTx.productBatch.findFirstOrThrow.mockResolvedValue({
        ...RAW_BATCH,
        quantityRemaining: 0,
      });
      mockTx.inventoryMovement.create.mockResolvedValue(rawMovement());
      mockTx.inventoryMovement.update.mockResolvedValue(rawMovement());

      const result = await makeService().createAdjustment(1, 5, {
        productBatchId: 55,
        quantityDelta: -5,
        reason: 'Full count-out',
      });

      expect(result.quantityRemaining).toBe(0);
    });
  });
});
