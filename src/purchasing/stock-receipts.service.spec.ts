import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StockReceiptsService } from './stock-receipts.service';

function decimal(n: number) {
  return { toNumber: () => n };
}

const FAR_FUTURE_DATE = '2099-01-01';

const RAW_PO_LINE = {
  lineId: 1,
  purchaseOrderId: 1,
  productId: 5,
  quantityOrdered: 10,
  quantityReceived: 0,
  unitCost: decimal(8),
  createdAt: new Date(2026, 0, 1, 9, 0),
  updatedAt: new Date(2026, 0, 1, 9, 0),
};

const RAW_PO = {
  purchaseOrderId: 1,
  tenantId: 1,
  supplierId: 1,
  status: 'pending',
  lines: [RAW_PO_LINE],
};

const RAW_RECEIPT = {
  receiptId: 100,
  tenantId: 1,
  purchaseOrderId: 1,
  receivedAt: new Date(2026, 0, 5, 9, 0),
  receivedBy: 7,
  notes: null,
  createdAt: new Date(2026, 0, 5, 9, 0),
};

const RAW_BATCH = { batchId: 55 };

function rawReceiptLine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    receiptLineId: 1,
    receiptId: 100,
    purchaseOrderLineId: 1,
    productId: 5,
    quantityReceived: 10,
    batchNumber: 'B1',
    expiryDate: new Date(FAR_FUTURE_DATE),
    unitCost: decimal(8),
    productBatchId: 55,
    createdAt: new Date(2026, 0, 5, 9, 0),
    ...overrides,
  };
}

const mockTx = {
  purchaseOrderLine: { findMany: jest.fn(), update: jest.fn() },
  stockReceipt: { create: jest.fn() },
  productBatch: { create: jest.fn() },
  stockReceiptLine: { create: jest.fn() },
  purchaseOrder: { update: jest.fn() },
  inventoryMovement: { create: jest.fn() },
};

const mockPrisma = {
  purchaseOrder: { findFirst: jest.fn(), count: jest.fn() },
  stockReceipt: { findMany: jest.fn(), count: jest.fn() },
  $transaction: jest.fn((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
};

const makeService = () => new StockReceiptsService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();

  mockPrisma.purchaseOrder.findFirst.mockResolvedValue(RAW_PO);
  mockPrisma.$transaction.mockImplementation(
    (cb: (tx: typeof mockTx) => unknown) => cb(mockTx),
  );

  mockTx.stockReceipt.create.mockResolvedValue(RAW_RECEIPT);
  mockTx.productBatch.create.mockResolvedValue(RAW_BATCH);
  mockTx.stockReceiptLine.create.mockResolvedValue(rawReceiptLine());
  mockTx.purchaseOrderLine.update.mockResolvedValue(RAW_PO_LINE);
  mockTx.purchaseOrder.update.mockResolvedValue({
    ...RAW_PO,
    status: 'received',
  });
  mockTx.inventoryMovement.create.mockResolvedValue({ movementId: BigInt(1) });
});

describe('StockReceiptsService', () => {
  describe('createReceipt', () => {
    it('receives the full outstanding quantity with no discrepancy, marking the PO received (AC-2, STORY-013 AC-2)', async () => {
      mockTx.purchaseOrderLine.findMany
        .mockResolvedValueOnce([RAW_PO_LINE]) // fresh snapshot before this receipt
        .mockResolvedValueOnce([{ ...RAW_PO_LINE, quantityReceived: 10 }]); // after increment

      const result = await makeService().createReceipt(1, 1, {
        lines: [
          {
            purchaseOrderLineId: 1,
            quantityReceived: 10,
            batchNumber: 'B1',
            expiryDate: FAR_FUTURE_DATE,
            unitCost: 8,
          },
        ],
      });

      expect(result.discrepancies).toHaveLength(0);
      expect(result.purchaseOrderStatus).toBe('received');
      expect(mockTx.productBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 1,
            productId: 5,
            batchNumber: 'B1',
            quantityReceived: 10,
            quantityRemaining: 10,
          }) as never,
        }),
      );
      expect(mockTx.purchaseOrderLine.update).toHaveBeenCalledWith({
        where: { lineId: 1 },
        data: { quantityReceived: { increment: 10 } },
      });
      expect(mockTx.purchaseOrder.update).toHaveBeenCalledWith({
        where: { purchaseOrderId: 1 },
        data: { status: 'received' },
      });
      expect(result.lines[0].productBatchId).toBe(55);

      // STORY-015: a receipt line always writes a matching InventoryMovement
      // row in the same transaction — the ledger and quantityRemaining must
      // never observably diverge.
      expect(mockTx.inventoryMovement.create).toHaveBeenCalledWith({
        data: {
          tenantId: 1,
          productId: 5,
          productBatchId: 55,
          movementType: 'receipt',
          quantityDelta: 10,
          referenceType: 'StockReceiptLine',
          referenceId: 1,
          actorId: null,
        },
      });
    });

    it('flags an under-receipt as a discrepancy but still succeeds (STORY-014 AC-1)', async () => {
      mockTx.purchaseOrderLine.findMany
        .mockResolvedValueOnce([RAW_PO_LINE])
        .mockResolvedValueOnce([{ ...RAW_PO_LINE, quantityReceived: 6 }]);
      mockTx.stockReceiptLine.create.mockResolvedValue(
        rawReceiptLine({ quantityReceived: 6 }),
      );
      mockTx.purchaseOrder.update.mockResolvedValue({
        ...RAW_PO,
        status: 'partially_received',
      });

      const result = await makeService().createReceipt(1, 1, {
        lines: [
          {
            purchaseOrderLineId: 1,
            quantityReceived: 6,
            batchNumber: 'B1',
            expiryDate: FAR_FUTURE_DATE,
            unitCost: 8,
          },
        ],
      });

      expect(result.discrepancies).toEqual([
        {
          purchaseOrderLineId: 1,
          productId: 5,
          quantityOrdered: 10,
          outstandingBeforeReceipt: 10,
          quantityReceivedThisReceipt: 6,
        },
      ]);
      expect(result.purchaseOrderStatus).toBe('partially_received');
    });

    it('flags an over-receipt as a discrepancy but still succeeds', async () => {
      const alreadyFull = { ...RAW_PO_LINE, quantityReceived: 10 };
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        ...RAW_PO,
        lines: [alreadyFull],
      });
      mockTx.purchaseOrderLine.findMany
        .mockResolvedValueOnce([alreadyFull])
        .mockResolvedValueOnce([{ ...alreadyFull, quantityReceived: 15 }]);
      mockTx.stockReceiptLine.create.mockResolvedValue(
        rawReceiptLine({ quantityReceived: 5 }),
      );

      const result = await makeService().createReceipt(1, 1, {
        lines: [
          {
            purchaseOrderLineId: 1,
            quantityReceived: 5,
            batchNumber: 'B2',
            expiryDate: FAR_FUTURE_DATE,
            unitCost: 8,
          },
        ],
      });

      expect(result.discrepancies).toEqual([
        {
          purchaseOrderLineId: 1,
          productId: 5,
          quantityOrdered: 10,
          outstandingBeforeReceipt: 0,
          quantityReceivedThisReceipt: 5,
        },
      ]);
      // 15 >= 10 on every line, so still "received" despite the over-receipt.
      expect(result.purchaseOrderStatus).toBe('received');
    });

    it('a second, completing receipt against a partially-received line reports no discrepancy (multi-event partial receiving)', async () => {
      const halfReceived = { ...RAW_PO_LINE, quantityReceived: 6 };
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        ...RAW_PO,
        lines: [halfReceived],
      });
      mockTx.purchaseOrderLine.findMany
        .mockResolvedValueOnce([halfReceived]) // cumulative from the first receipt
        .mockResolvedValueOnce([{ ...halfReceived, quantityReceived: 10 }]);
      mockTx.stockReceiptLine.create.mockResolvedValue(
        rawReceiptLine({ quantityReceived: 4 }),
      );

      const result = await makeService().createReceipt(1, 1, {
        lines: [
          {
            purchaseOrderLineId: 1,
            quantityReceived: 4,
            batchNumber: 'B2',
            expiryDate: FAR_FUTURE_DATE,
            unitCost: 8,
          },
        ],
      });

      expect(result.discrepancies).toHaveLength(0);
      expect(result.purchaseOrderStatus).toBe('received');
    });

    it('throws NotFoundException when the PO does not belong to the tenant', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(
        makeService().createReceipt(1, 999, {
          lines: [
            {
              purchaseOrderLineId: 1,
              quantityReceived: 1,
              batchNumber: 'B1',
              expiryDate: FAR_FUTURE_DATE,
              unitCost: 1,
            },
          ],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when purchaseOrderLineId does not belong to this PO', async () => {
      await expect(
        makeService().createReceipt(1, 1, {
          lines: [
            {
              purchaseOrderLineId: 999,
              quantityReceived: 1,
              batchNumber: 'B1',
              expiryDate: FAR_FUTURE_DATE,
              unitCost: 1,
            },
          ],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when expiryDate is in the past (AC-3)', async () => {
      await expect(
        makeService().createReceipt(1, 1, {
          lines: [
            {
              purchaseOrderLineId: 1,
              quantityReceived: 1,
              batchNumber: 'B1',
              expiryDate: '2000-01-01',
              unitCost: 1,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('findAllForPurchaseOrder', () => {
    it('throws NotFoundException when the PO does not belong to the tenant', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(
        makeService().findAllForPurchaseOrder(1, 999, {
          page: 1,
          per_page: 25,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lists receipts scoped to the purchase order', async () => {
      mockPrisma.stockReceipt.findMany.mockResolvedValue([
        { ...RAW_RECEIPT, lines: [rawReceiptLine()] },
      ]);
      mockPrisma.stockReceipt.count.mockResolvedValue(1);

      const result = await makeService().findAllForPurchaseOrder(1, 1, {
        page: 1,
        per_page: 25,
      });

      expect(mockPrisma.stockReceipt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { purchaseOrderId: 1 } }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].lines[0].quantityReceived).toBe(10);
    });
  });
});
