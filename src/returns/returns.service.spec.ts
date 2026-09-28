import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ReturnsService } from './returns.service';

// Decimal-like stand-in — mirrors sales.service.spec.ts's convention: the
// service only ever calls .toNumber() on a real Prisma Decimal.
const decimal = (n: number) => ({ toNumber: () => n });

const mockTx = {
  return: { create: jest.fn(), update: jest.fn() },
  returnLine: { create: jest.fn(), aggregate: jest.fn() },
  productBatch: { update: jest.fn() },
  inventoryMovement: { create: jest.fn() },
  $executeRaw: jest.fn(),
};

const mockPrisma = {
  sale: { findFirst: jest.fn() },
  saleLineBatchAllocation: { findMany: jest.fn() },
  productBatch: { findMany: jest.fn() },
  user: { findFirst: jest.fn() },
  return: { findFirst: jest.fn() },
  $transaction: jest.fn((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
};

const makeService = () => new ReturnsService(mockPrisma as never);

let returnLineAutoId = 1;

beforeEach(() => {
  jest.clearAllMocks();
  returnLineAutoId = 1;
  mockPrisma.$transaction.mockImplementation(
    (cb: (tx: typeof mockTx) => unknown) => cb(mockTx),
  );
  mockTx.return.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ returnId: 900, ...data }),
  );
  mockTx.return.update.mockResolvedValue({});
  mockTx.returnLine.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ returnLineId: returnLineAutoId++, ...data }),
  );
  mockTx.returnLine.aggregate.mockResolvedValue({ _sum: { quantity: null } });
  mockTx.productBatch.update.mockResolvedValue({});
  mockTx.inventoryMovement.create.mockResolvedValue({});
  mockTx.$executeRaw.mockResolvedValue(1);

  // create()'s final step re-reads via getReturn() — a generic default so
  // tests that only assert on the tx calls above don't need to care about
  // the final read's shape.
  mockPrisma.return.findFirst.mockResolvedValue({
    returnId: 900,
    tenantId: 1,
    saleId: 10,
    reason: 'test',
    overrideApprovedBy: null,
    processedBy: 7,
    refundTotal: decimal(0),
    returnDate: new Date(2026, 0, 1),
    lines: [],
  });
});

describe('ReturnsService', () => {
  describe('create — matched case (STORY-023)', () => {
    const allocation = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 1,
      quantity: 3,
      productBatchId: 50,
      saleLine: {
        saleLineId: 200,
        saleId: 10,
        productId: 5,
        unitPrice: decimal(10),
        sale: { saleId: 10, tenantId: 1 },
      },
      ...overrides,
    });

    it('throws NotFoundException when the sale does not belong to the tenant', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue(null);

      await expect(
        makeService().create(1, {
          saleId: 10,
          reason: 'Damaged',
          lines: [{ saleLineBatchAllocationId: 1, quantity: 2 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a line omits saleLineBatchAllocationId', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({ saleId: 10 });

      await expect(
        makeService().create(1, {
          saleId: 10,
          reason: 'Damaged',
          lines: [{ quantity: 2 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the allocation does not belong to the given sale', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({ saleId: 10 });
      mockPrisma.saleLineBatchAllocation.findMany.mockResolvedValue([
        allocation({ saleLine: { ...allocation().saleLine, saleId: 999 } }),
      ]);

      await expect(
        makeService().create(1, {
          saleId: 10,
          reason: 'Damaged',
          lines: [{ saleLineBatchAllocationId: 1, quantity: 2 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('increments the batch, writes one ReturnLine and one return-type InventoryMovement, and stamps refundTotal from the frozen SaleLine.unitPrice', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({ saleId: 10 });
      mockPrisma.saleLineBatchAllocation.findMany.mockResolvedValue([
        allocation(),
      ]);

      await makeService().create(
        1,
        {
          saleId: 10,
          reason: 'Damaged on delivery',
          lines: [{ saleLineBatchAllocationId: 1, quantity: 2 }],
        },
        7,
      );

      expect(mockTx.$executeRaw).toHaveBeenCalled();
      expect(mockTx.returnLine.create).toHaveBeenCalledWith({
        data: {
          returnId: 900,
          productId: 5,
          saleLineBatchAllocationId: 1,
          productBatchId: 50,
          quantity: 2,
          unitPrice: 10,
          lineTotal: 20,
        },
      });
      expect(mockTx.productBatch.update).toHaveBeenCalledWith({
        where: { batchId: 50 },
        data: { quantityRemaining: { increment: 2 } },
      });
      expect(mockTx.inventoryMovement.create).toHaveBeenCalledWith({
        data: {
          tenantId: 1,
          productId: 5,
          productBatchId: 50,
          movementType: 'return',
          quantityDelta: 2,
          referenceType: 'ReturnLine',
          referenceId: 1,
          actorId: 7,
        },
      });
      expect(mockTx.return.update).toHaveBeenCalledWith({
        where: { returnId: 900 },
        data: { refundTotal: 20 },
      });
    });

    it('throws ConflictException (409) when this request would push an allocation past its original quantity, and writes no ReturnLine (the TOCTOU-guard case)', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({ saleId: 10 });
      mockPrisma.saleLineBatchAllocation.findMany.mockResolvedValue([
        allocation({ quantity: 3 }),
      ]);
      // Another return already consumed 2 of this allocation's 3 units —
      // requesting 2 more here (2+2=4 > 3) must be rejected.
      mockTx.returnLine.aggregate.mockResolvedValue({ _sum: { quantity: 2 } });

      await expect(
        makeService().create(1, {
          saleId: 10,
          reason: 'Damaged',
          lines: [{ saleLineBatchAllocationId: 1, quantity: 2 }],
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockTx.returnLine.create).not.toHaveBeenCalled();
      expect(mockTx.productBatch.update).not.toHaveBeenCalled();
    });
  });

  describe('create — override case (STORY-024)', () => {
    const overrideDto = () => ({
      reason: 'No receipt on file',
      overrideApprovedBy: 2,
      lines: [{ productId: 5, productBatchId: 50, quantity: 2, unitPrice: 15 }],
    });

    it('throws ForbiddenException when overrideApprovedBy does not name a real user in this tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        makeService().create(1, overrideDto() as never),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when overrideApprovedBy names a user who lacks returns:override', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        roles: [
          {
            role: {
              permissions: [{ permission: { name: 'returns:create' } }],
            },
          },
        ],
      });

      await expect(
        makeService().create(1, overrideDto() as never),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a line omits productBatchId', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        roles: [
          {
            role: {
              permissions: [{ permission: { name: 'returns:override' } }],
            },
          },
        ],
      });

      await expect(
        makeService().create(1, {
          reason: 'No receipt',
          overrideApprovedBy: 2,
          lines: [{ productId: 5, quantity: 1, unitPrice: 10 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when productBatchId does not belong to productId in this tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        roles: [
          {
            role: {
              permissions: [{ permission: { name: 'returns:override' } }],
            },
          },
        ],
      });
      mockPrisma.productBatch.findMany.mockResolvedValue([]);

      await expect(
        makeService().create(1, overrideDto() as never),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('with an authorized approver, increments the caller-specified batch directly and writes a return-type InventoryMovement — no allocation ceiling applies', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        roles: [
          {
            role: {
              permissions: [{ permission: { name: 'returns:override' } }],
            },
          },
        ],
      });
      mockPrisma.productBatch.findMany.mockResolvedValue([
        { batchId: 50, productId: 5 },
      ]);

      await makeService().create(1, overrideDto(), 7);

      expect(mockTx.return.create).toHaveBeenCalledWith({
        data: {
          tenantId: 1,
          saleId: null,
          reason: 'No receipt on file',
          overrideApprovedBy: 2,
          processedBy: 7,
          refundTotal: 0,
        },
      });
      expect(mockTx.returnLine.create).toHaveBeenCalledWith({
        data: {
          returnId: 900,
          productId: 5,
          saleLineBatchAllocationId: null,
          productBatchId: 50,
          quantity: 2,
          unitPrice: 15,
          lineTotal: 30,
        },
      });
      expect(mockTx.productBatch.update).toHaveBeenCalledWith({
        where: { batchId: 50 },
        data: { quantityRemaining: { increment: 2 } },
      });
      expect(mockTx.inventoryMovement.create).toHaveBeenCalledWith({
        data: {
          tenantId: 1,
          productId: 5,
          productBatchId: 50,
          movementType: 'return',
          quantityDelta: 2,
          referenceType: 'ReturnLine',
          referenceId: 1,
          actorId: 7,
        },
      });
    });
  });

  describe('getReturn', () => {
    it('throws NotFoundException when the return does not belong to the tenant', async () => {
      mockPrisma.return.findFirst.mockResolvedValue(null);

      await expect(makeService().getReturn(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
