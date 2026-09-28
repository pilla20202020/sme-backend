import 'dotenv/config';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../catalog/products.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { TenantsService } from '../tenants/tenants.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { StockReceiptsService } from './stock-receipts.service';

/**
 * Proves STORY-013/STORY-014's core claims end to end against the REAL
 * local database (mirrors the real-DB pattern established by
 * src/auth/rbac-enforcement.spec.ts): a PO received across two separate,
 * sequential receipt events accumulates quantityReceived correctly, its
 * status is recomputed fresh from cumulative totals each time (not just the
 * latest receipt), a real ProductBatch row is created per receipt line, and
 * an under-receipt is flagged as a discrepancy without being rejected or
 * force-matched.
 */
describe('StockReceiptsService — partial receiving across two events (real DB)', () => {
  let prisma: PrismaService;
  let tenantsService: TenantsService;
  let suppliersService: SuppliersService;
  let productsService: ProductsService;
  let purchaseOrdersService: PurchaseOrdersService;
  let stockReceiptsService: StockReceiptsService;

  beforeAll(() => {
    prisma = new PrismaService();
    tenantsService = new TenantsService(prisma);
    suppliersService = new SuppliersService(prisma);
    productsService = new ProductsService(prisma);
    purchaseOrdersService = new PurchaseOrdersService(prisma);
    stockReceiptsService = new StockReceiptsService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('accumulates quantityReceived and status across two receipt events, flagging the first (partial) as a discrepancy', async () => {
    const tenant = await tenantsService.register({
      name: `Partial Receiving Test ${Date.now()}`,
    });
    const supplier = await suppliersService.create(tenant.tenantId, {
      name: 'Partial Receiving Supplier',
    });
    const product = await productsService.create(tenant.tenantId, {
      name: 'Partial Receiving Product',
      unit: 'box',
      currentPrice: 15,
    });

    const po = await purchaseOrdersService.create(tenant.tenantId, {
      supplierId: supplier.supplierId,
      lines: [
        { productId: product.productId, quantityOrdered: 100, unitCost: 12 },
      ],
    });
    const lineId = po.lines[0].lineId;

    // First receipt: only 60 of the 100 outstanding units arrive.
    const firstReceipt = await stockReceiptsService.createReceipt(
      tenant.tenantId,
      po.purchaseOrderId,
      {
        lines: [
          {
            purchaseOrderLineId: lineId,
            quantityReceived: 60,
            batchNumber: 'LOT-A',
            expiryDate: '2099-01-01',
            unitCost: 12,
          },
        ],
      },
    );

    expect(firstReceipt.discrepancies).toEqual([
      {
        purchaseOrderLineId: lineId,
        productId: product.productId,
        quantityOrdered: 100,
        outstandingBeforeReceipt: 100,
        quantityReceivedThisReceipt: 60,
      },
    ]);
    expect(firstReceipt.purchaseOrderStatus).toBe('partially_received');
    expect(firstReceipt.lines[0].productBatchId).not.toBeNull();

    const firstBatch = await prisma.productBatch.findUnique({
      where: { batchId: firstReceipt.lines[0].productBatchId! },
    });
    expect(firstBatch?.batchNumber).toBe('LOT-A');
    expect(firstBatch?.quantityReceived).toBe(60);
    expect(firstBatch?.quantityRemaining).toBe(60);

    const afterFirst = await purchaseOrdersService.findById(
      tenant.tenantId,
      po.purchaseOrderId,
    );
    expect(afterFirst.status).toBe('partially_received');
    expect(afterFirst.lines[0].quantityReceived).toBe(60);

    // Second receipt: the remaining 40 units arrive — this exactly matches
    // the outstanding amount, so no discrepancy this time.
    const secondReceipt = await stockReceiptsService.createReceipt(
      tenant.tenantId,
      po.purchaseOrderId,
      {
        lines: [
          {
            purchaseOrderLineId: lineId,
            quantityReceived: 40,
            batchNumber: 'LOT-B',
            expiryDate: '2099-01-01',
            unitCost: 12,
          },
        ],
      },
    );

    expect(secondReceipt.discrepancies).toHaveLength(0);
    expect(secondReceipt.purchaseOrderStatus).toBe('received');

    const afterSecond = await purchaseOrdersService.findById(
      tenant.tenantId,
      po.purchaseOrderId,
    );
    expect(afterSecond.status).toBe('received');
    // Cumulative across BOTH receipts, not just the latest one.
    expect(afterSecond.lines[0].quantityReceived).toBe(100);

    const receiptsList = await stockReceiptsService.findAllForPurchaseOrder(
      tenant.tenantId,
      po.purchaseOrderId,
      { page: 1, per_page: 25 },
    );
    expect(receiptsList.meta.total).toBe(2);
  });

  it('rejects a receipt line whose expiryDate is in the past (STORY-014 AC-3)', async () => {
    const tenant = await tenantsService.register({
      name: `Expiry Reject Test ${Date.now()}`,
    });
    const supplier = await suppliersService.create(tenant.tenantId, {
      name: 'Expiry Reject Supplier',
    });
    const product = await productsService.create(tenant.tenantId, {
      name: 'Expiry Reject Product',
      unit: 'box',
      currentPrice: 5,
    });
    const po = await purchaseOrdersService.create(tenant.tenantId, {
      supplierId: supplier.supplierId,
      lines: [
        { productId: product.productId, quantityOrdered: 10, unitCost: 4 },
      ],
    });

    await expect(
      stockReceiptsService.createReceipt(tenant.tenantId, po.purchaseOrderId, {
        lines: [
          {
            purchaseOrderLineId: po.lines[0].lineId,
            quantityReceived: 10,
            batchNumber: 'EXPIRED',
            expiryDate: '2000-01-01',
            unitCost: 4,
          },
        ],
      }),
    ).rejects.toThrow('expiryDate cannot be in the past');

    // Rejected before the transaction ran — no batch and no PO-line mutation.
    const unchanged = await purchaseOrdersService.findById(
      tenant.tenantId,
      po.purchaseOrderId,
    );
    expect(unchanged.lines[0].quantityReceived).toBe(0);
    expect(unchanged.status).toBe('pending');
  });
});
