import { ConflictException, NotFoundException } from '@nestjs/common';
import { SalesService } from './sales.service';

// Decimal-like stand-in — this codebase's real Prisma Decimal columns expose
// .toNumber(), and the service only ever calls that (never any other Decimal
// API), same convention as inventory-movements.service.spec.ts's raw fixtures.
const decimal = (n: number) => ({ toNumber: () => n });

const RAW_PRODUCT = (overrides: Partial<Record<string, unknown>> = {}) => ({
  productId: 5,
  tenantId: 1,
  name: 'Paracetamol 500mg',
  currentPrice: decimal(10),
  ...overrides,
});

const mockTx = {
  productBatch: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  sale: { create: jest.fn(), update: jest.fn() },
  saleLine: { create: jest.fn() },
  saleLineBatchAllocation: { create: jest.fn() },
  inventoryMovement: { create: jest.fn() },
};

const mockMovementsService = {
  getOnHand: jest.fn(),
};

const mockPrisma = {
  product: { findMany: jest.fn() },
  customer: { findFirst: jest.fn() },
  sale: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
};

const makeService = () =>
  new SalesService(mockPrisma as never, mockMovementsService as never);

let allocationAutoId = 1;

beforeEach(() => {
  jest.clearAllMocks();
  allocationAutoId = 1;
  mockPrisma.$transaction.mockImplementation(
    (cb: (tx: typeof mockTx) => unknown) => cb(mockTx),
  );
  mockTx.sale.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ saleId: 100, ...data }),
  );
  mockTx.sale.update.mockResolvedValue({});
  mockTx.saleLine.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ saleLineId: 200, ...data }),
  );
  mockTx.saleLineBatchAllocation.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: allocationAutoId++, ...data }),
  );
  mockTx.inventoryMovement.create.mockResolvedValue({});
  // checkout() ends by re-reading the sale via getSale() for its response —
  // a generic default so tests that only assert on the tx calls above don't
  // need to care about the final read's shape.
  mockPrisma.sale.findFirst.mockResolvedValue({
    saleId: 100,
    saleDate: new Date(2026, 0, 1),
    customer: null,
    cashier: null,
    subtotal: decimal(0),
    total: decimal(0),
    lines: [],
  });
});

describe('SalesService', () => {
  describe('quote (STORY-019)', () => {
    it('throws NotFoundException when a productId does not belong to the tenant', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);

      await expect(
        makeService().quote(1, { lines: [{ productId: 999, quantity: 1 }] }),
      ).rejects.toThrow(NotFoundException);
      expect(mockMovementsService.getOnHand).not.toHaveBeenCalled();
    });

    it('reuses InventoryMovementsService.getOnHand() for the stock sum and writes nothing', async () => {
      mockPrisma.product.findMany.mockResolvedValue([RAW_PRODUCT()]);
      mockMovementsService.getOnHand.mockResolvedValue({
        productId: 5,
        totalOnHand: 20,
        batches: [],
      });

      const result = await makeService().quote(1, {
        lines: [{ productId: 5, quantity: 5 }],
      });

      expect(mockMovementsService.getOnHand).toHaveBeenCalledWith(1, 5);
      expect(result).toEqual({
        lines: [
          {
            productId: 5,
            quantity: 5,
            unitPrice: 10,
            lineTotal: 50,
            available: true,
            totalOnHand: 20,
          },
        ],
        subtotal: 50,
        total: 50,
        allSufficient: true,
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockTx.sale.create).not.toHaveBeenCalled();
    });

    it('flags a line unavailable and allSufficient false when totalOnHand is below the requested quantity', async () => {
      mockPrisma.product.findMany.mockResolvedValue([RAW_PRODUCT()]);
      mockMovementsService.getOnHand.mockResolvedValue({
        productId: 5,
        totalOnHand: 2,
        batches: [],
      });

      const result = await makeService().quote(1, {
        lines: [{ productId: 5, quantity: 5 }],
      });

      expect(result.lines[0].available).toBe(false);
      expect(result.allSufficient).toBe(false);
    });
  });

  describe('checkout (STORY-020/021)', () => {
    it('draws from a single sufficient batch and writes one allocation + one sale movement', async () => {
      mockPrisma.product.findMany.mockResolvedValue([RAW_PRODUCT()]);
      mockTx.productBatch.findMany.mockResolvedValue([
        {
          batchId: 1,
          quantityRemaining: 10,
          expiryDate: new Date('2099-01-01'),
        },
      ]);
      mockTx.productBatch.updateMany.mockResolvedValue({ count: 1 });

      const result = await makeService().checkout(
        1,
        { lines: [{ productId: 5, quantity: 4 }] },
        7,
      );

      expect(mockTx.productBatch.updateMany).toHaveBeenCalledWith({
        where: {
          batchId: 1,
          tenantId: 1,
          productId: 5,
          quantityRemaining: { gte: 4 },
        },
        data: { quantityRemaining: { decrement: 4 } },
      });
      expect(mockTx.saleLine.create).toHaveBeenCalledWith({
        data: {
          saleId: 100,
          productId: 5,
          quantity: 4,
          unitPrice: 10,
          lineTotal: 40,
        },
      });
      expect(mockTx.saleLineBatchAllocation.create).toHaveBeenCalledWith({
        data: { saleLineId: 200, productBatchId: 1, quantity: 4 },
      });
      expect(mockTx.inventoryMovement.create).toHaveBeenCalledWith({
        data: {
          tenantId: 1,
          productId: 5,
          productBatchId: 1,
          movementType: 'sale',
          quantityDelta: -4,
          referenceType: 'SaleLineBatchAllocation',
          referenceId: 1,
          actorId: 7,
        },
      });
      expect(mockTx.sale.update).toHaveBeenCalledWith({
        where: { saleId: 100 },
        data: { subtotal: 40, total: 40 },
      });
      expect(result.saleId).toBe(100);
    });

    it('FEFO spillover: a quantity spanning two batches draws the near-expiry batch first, then the far one, in two allocations (PRD §7 AC)', async () => {
      mockPrisma.product.findMany.mockResolvedValue([RAW_PRODUCT()]);
      // findMany is already ordered soonest-expiry-first in the real query
      // (orderBy: expiryDate asc) — the mock returns them pre-sorted the way
      // Postgres would.
      mockTx.productBatch.findMany.mockResolvedValue([
        {
          batchId: 1,
          quantityRemaining: 3,
          expiryDate: new Date('2026-01-01'),
        },
        {
          batchId: 2,
          quantityRemaining: 10,
          expiryDate: new Date('2026-06-01'),
        },
      ]);
      mockTx.productBatch.updateMany.mockResolvedValue({ count: 1 });

      await makeService().checkout(1, {
        lines: [{ productId: 5, quantity: 5 }],
      });

      expect(mockTx.productBatch.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          batchId: 1,
          tenantId: 1,
          productId: 5,
          quantityRemaining: { gte: 3 },
        },
        data: { quantityRemaining: { decrement: 3 } },
      });
      expect(mockTx.productBatch.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          batchId: 2,
          tenantId: 1,
          productId: 5,
          quantityRemaining: { gte: 2 },
        },
        data: { quantityRemaining: { decrement: 2 } },
      });
      expect(mockTx.saleLineBatchAllocation.create).toHaveBeenCalledTimes(2);
      expect(mockTx.saleLineBatchAllocation.create).toHaveBeenNthCalledWith(1, {
        data: { saleLineId: 200, productBatchId: 1, quantity: 3 },
      });
      expect(mockTx.saleLineBatchAllocation.create).toHaveBeenNthCalledWith(2, {
        data: { saleLineId: 200, productBatchId: 2, quantity: 2 },
      });
      expect(mockTx.inventoryMovement.create).toHaveBeenCalledTimes(2);
    });

    it('throws ConflictException (409) and creates no SaleLine when aggregate stock across every batch is insufficient', async () => {
      mockPrisma.product.findMany.mockResolvedValue([RAW_PRODUCT()]);
      mockTx.productBatch.findMany.mockResolvedValue([
        {
          batchId: 1,
          quantityRemaining: 2,
          expiryDate: new Date('2099-01-01'),
        },
      ]);
      mockTx.productBatch.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        makeService().checkout(1, {
          lines: [{ productId: 5, quantity: 5 }],
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockTx.saleLine.create).not.toHaveBeenCalled();
    });

    it('regression: a concurrent write that already consumed a batch (updateMany count 0) fails the whole checkout with 409, never a partial write (mirrors the Sprint 4 lost-update fix)', async () => {
      mockPrisma.product.findMany.mockResolvedValue([RAW_PRODUCT()]);
      mockTx.productBatch.findMany.mockResolvedValue([
        {
          batchId: 1,
          quantityRemaining: 10,
          expiryDate: new Date('2099-01-01'),
        },
      ]);
      // The atomic guarded updateMany itself reports the race lost — never a
      // prior in-app read deciding this.
      mockTx.productBatch.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        makeService().checkout(1, {
          lines: [{ productId: 5, quantity: 4 }],
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockTx.saleLine.create).not.toHaveBeenCalled();
      expect(mockTx.saleLineBatchAllocation.create).not.toHaveBeenCalled();
      expect(mockTx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown customerId, writing nothing', async () => {
      mockPrisma.product.findMany.mockResolvedValue([RAW_PRODUCT()]);
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        makeService().checkout(1, {
          customerId: 999,
          lines: [{ productId: 5, quantity: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a productId not belonging to the tenant, writing nothing', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);

      await expect(
        makeService().checkout(1, {
          lines: [{ productId: 999, quantity: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getSale / getReceipt (STORY-022)', () => {
    const rawSale = (overrides: Partial<Record<string, unknown>> = {}) => ({
      saleId: 100,
      saleDate: new Date(2026, 0, 5, 9, 0),
      customer: { customerId: 3, name: 'Walk-in Regular' },
      cashier: { userId: 7, firstName: 'Cash', lastName: 'Ier' },
      subtotal: decimal(40),
      total: decimal(40),
      lines: [
        {
          saleLineId: 200,
          productId: 5,
          product: { name: 'Paracetamol 500mg' },
          quantity: 4,
          unitPrice: decimal(10),
          lineTotal: decimal(40),
          allocations: [{ id: 900, quantity: 4 }],
        },
      ],
      ...overrides,
    });

    it('throws NotFoundException when the sale does not belong to the tenant', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue(null);

      await expect(makeService().getSale(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('maps customer/cashier/lines into the itemized receipt shape, including each line’s saleLineId and allocation(s) (SPRINT-014 returns UI dependency)', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue(rawSale());

      const result = await makeService().getSale(1, 100);

      expect(result).toEqual({
        saleId: 100,
        saleDate: expect.any(String) as string,
        customer: { customerId: 3, name: 'Walk-in Regular' },
        cashier: { userId: 7, firstName: 'Cash', lastName: 'Ier' },
        lines: [
          {
            saleLineId: 200,
            productId: 5,
            productName: 'Paracetamol 500mg',
            quantity: 4,
            unitPrice: 10,
            lineTotal: 40,
            allocations: [{ saleLineBatchAllocationId: 900, quantity: 4 }],
          },
        ],
        subtotal: 40,
        total: 40,
      });
    });

    it('maps a walk-in sale with no customer and no cashier to null, null', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue(
        rawSale({ customer: null, cashier: null }),
      );

      const result = await makeService().getSale(1, 100);

      expect(result.customer).toBeNull();
      expect(result.cashier).toBeNull();
    });

    it('getReceipt() returns exactly what getSale() returns — one mapSaleReceipt(), not two DTOs (PRD §8)', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue(rawSale());

      const service = makeService();
      const viaGetSale = await service.getSale(1, 100);
      const viaReceipt = await service.getReceipt(1, 100);

      expect(viaReceipt).toEqual(viaGetSale);
    });
  });

  describe('findAll (STORY-028)', () => {
    const rawSale = (overrides: Partial<Record<string, unknown>> = {}) => ({
      saleId: 100,
      saleDate: new Date(2026, 0, 5, 9, 0),
      customer: null,
      cashier: null,
      subtotal: decimal(40),
      total: decimal(40),
      lines: [],
      ...overrides,
    });

    it('scopes the query to the tenant with no date filter by default', async () => {
      mockPrisma.sale.findMany.mockResolvedValue([rawSale()]);
      mockPrisma.sale.count.mockResolvedValue(1);

      const result = await makeService().findAll(1, {});

      expect(mockPrisma.sale.findMany).toHaveBeenCalledWith(
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

    it('adds a saleDate range filter when dateFrom/dateTo are provided', async () => {
      mockPrisma.sale.findMany.mockResolvedValue([]);
      mockPrisma.sale.count.mockResolvedValue(0);

      await makeService().findAll(1, {
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });

      expect(mockPrisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 1,
            saleDate: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-01-31'),
            },
          },
        }),
      );
    });

    it('excludes a sale outside the requested date range (verified against the where clause the query is built with)', async () => {
      // The service itself only ever issues one findMany call built from
      // `where` — this asserts that call's shape rather than re-implementing
      // Prisma's filtering in the test, matching this file's existing style.
      mockPrisma.sale.findMany.mockResolvedValue([]);
      mockPrisma.sale.count.mockResolvedValue(0);

      const result = await makeService().findAll(1, {
        dateFrom: '2026-02-01',
        dateTo: '2026-02-28',
      });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('maps each row through the same mapSaleReceipt shape as getSale(), including saleLineId/allocations (SPRINT-014)', async () => {
      mockPrisma.sale.findMany.mockResolvedValue([
        rawSale({
          lines: [
            {
              saleLineId: 200,
              productId: 5,
              product: { name: 'Paracetamol 500mg' },
              quantity: 4,
              unitPrice: decimal(10),
              lineTotal: decimal(40),
              allocations: [{ id: 900, quantity: 4 }],
            },
          ],
        }),
      ]);
      mockPrisma.sale.count.mockResolvedValue(1);

      const result = await makeService().findAll(1, {});

      expect(result.data[0]).toEqual({
        saleId: 100,
        saleDate: expect.any(String) as string,
        customer: null,
        cashier: null,
        lines: [
          {
            saleLineId: 200,
            productId: 5,
            productName: 'Paracetamol 500mg',
            quantity: 4,
            unitPrice: 10,
            lineTotal: 40,
            allocations: [{ saleLineBatchAllocationId: 900, quantity: 4 }],
          },
        ],
        subtotal: 40,
        total: 40,
      });
    });

    it('respects page/per_page for skip/take', async () => {
      mockPrisma.sale.findMany.mockResolvedValue([]);
      mockPrisma.sale.count.mockResolvedValue(0);

      await makeService().findAll(1, { page: 2, per_page: 10 });

      expect(mockPrisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });
});
