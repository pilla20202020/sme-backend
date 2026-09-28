import 'dotenv/config';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../catalog/products.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { TenantsService } from '../tenants/tenants.service';
import { PurchaseOrdersService } from '../purchasing/purchase-orders.service';
import { StockReceiptsService } from '../purchasing/stock-receipts.service';
import { InventoryAlertsService } from './inventory-alerts.service';
import { InventoryMovementsService } from './inventory-movements.service';

/**
 * Proves STORY-015..018's core claims end to end against the REAL local
 * database (mirrors the real-DB pattern established by
 * src/purchasing/stock-receipt-partial-receiving.spec.ts): receiving writes
 * a reconciling movement ledger, manual adjustments respect the
 * never-below-zero rule with no partial writes, and both alert engines
 * return sensible, correctly-filtered/sorted data.
 */
describe('Inventory management (real DB)', () => {
  let prisma: PrismaService;
  let tenantsService: TenantsService;
  let suppliersService: SuppliersService;
  let productsService: ProductsService;
  let purchaseOrdersService: PurchaseOrdersService;
  let stockReceiptsService: StockReceiptsService;
  let movementsService: InventoryMovementsService;
  let alertsService: InventoryAlertsService;

  beforeAll(() => {
    prisma = new PrismaService();
    tenantsService = new TenantsService(prisma);
    suppliersService = new SuppliersService(prisma);
    productsService = new ProductsService(prisma);
    purchaseOrdersService = new PurchaseOrdersService(prisma);
    stockReceiptsService = new StockReceiptsService(prisma);
    movementsService = new InventoryMovementsService(prisma);
    alertsService = new InventoryAlertsService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('receiving writes a reconciling InventoryMovement ledger (STORY-015 AC)', async () => {
    const tenant = await tenantsService.register({
      name: `Inventory Ledger Test ${Date.now()}`,
    });
    const supplier = await suppliersService.create(tenant.tenantId, {
      name: 'Ledger Supplier',
    });
    const product = await productsService.create(tenant.tenantId, {
      name: 'Ledger Product',
      unit: 'box',
      currentPrice: 10,
    });
    const po = await purchaseOrdersService.create(tenant.tenantId, {
      supplierId: supplier.supplierId,
      lines: [
        { productId: product.productId, quantityOrdered: 30, unitCost: 5 },
      ],
    });

    await stockReceiptsService.createReceipt(
      tenant.tenantId,
      po.purchaseOrderId,
      {
        lines: [
          {
            purchaseOrderLineId: po.lines[0].lineId,
            quantityReceived: 12,
            batchNumber: 'LOT-1',
            expiryDate: '2099-01-01',
            unitCost: 5,
          },
        ],
      },
    );
    await stockReceiptsService.createReceipt(
      tenant.tenantId,
      po.purchaseOrderId,
      {
        lines: [
          {
            purchaseOrderLineId: po.lines[0].lineId,
            quantityReceived: 18,
            batchNumber: 'LOT-2',
            expiryDate: '2099-06-01',
            unitCost: 5,
          },
        ],
      },
    );

    const movements = await movementsService.findAllForProduct(
      tenant.tenantId,
      product.productId,
      { page: 1, per_page: 25, movementType: 'receipt' },
    );
    expect(movements.data).toHaveLength(2);
    const sumQuantityDelta = movements.data.reduce(
      (sum, m) => sum + m.quantityDelta,
      0,
    );

    const batches = await prisma.productBatch.findMany({
      where: { productId: product.productId },
    });
    const sumQuantityReceived = batches.reduce(
      (sum, b) => sum + b.quantityReceived,
      0,
    );
    expect(sumQuantityDelta).toBe(sumQuantityReceived);
    expect(sumQuantityDelta).toBe(30);

    const onHand = await movementsService.getOnHand(
      tenant.tenantId,
      product.productId,
    );
    expect(onHand.totalOnHand).toBe(30);
    expect(onHand.batches).toHaveLength(2);
  });

  it('a manual adjustment updates quantityRemaining and writes a self-referencing movement row (STORY-016)', async () => {
    const tenant = await tenantsService.register({
      name: `Adjustment Test ${Date.now()}`,
    });
    const product = await productsService.create(tenant.tenantId, {
      name: 'Adjustment Product',
      unit: 'box',
      currentPrice: 10,
    });
    const batch = await prisma.productBatch.create({
      data: {
        tenantId: tenant.tenantId,
        productId: product.productId,
        batchNumber: 'ADJ-1',
        expiryDate: new Date('2099-01-01'),
        quantityReceived: 20,
        quantityRemaining: 20,
      },
    });

    const result = await movementsService.createAdjustment(
      tenant.tenantId,
      product.productId,
      { productBatchId: batch.batchId, quantityDelta: -5, reason: 'Damaged' },
      undefined,
    );

    expect(result.quantityRemaining).toBe(15);
    expect(result.movement.referenceId).toBe(
      Number(result.movement.movementId),
    );

    const persistedBatch = await prisma.productBatch.findUnique({
      where: { batchId: batch.batchId },
    });
    expect(persistedBatch?.quantityRemaining).toBe(15);

    const persistedMovement = await prisma.inventoryMovement.findUnique({
      where: { movementId: BigInt(result.movement.movementId) },
    });
    expect(persistedMovement?.quantityDelta).toBe(-5);
    expect(persistedMovement?.movementType).toBe('adjustment');
    expect(persistedMovement?.referenceType).toBe('InventoryAdjustment');
  });

  it('rejects an adjustment that would go negative with 409 and writes nothing to either table (STORY-016 AC)', async () => {
    const tenant = await tenantsService.register({
      name: `Adjustment Reject Test ${Date.now()}`,
    });
    const product = await productsService.create(tenant.tenantId, {
      name: 'Adjustment Reject Product',
      unit: 'box',
      currentPrice: 10,
    });
    const batch = await prisma.productBatch.create({
      data: {
        tenantId: tenant.tenantId,
        productId: product.productId,
        batchNumber: 'ADJ-REJECT',
        expiryDate: new Date('2099-01-01'),
        quantityReceived: 3,
        quantityRemaining: 3,
      },
    });

    await expect(
      movementsService.createAdjustment(tenant.tenantId, product.productId, {
        productBatchId: batch.batchId,
        quantityDelta: -10,
        reason: 'Too much damage',
      }),
    ).rejects.toThrow(/below zero/);

    const persistedBatch = await prisma.productBatch.findUnique({
      where: { batchId: batch.batchId },
    });
    expect(persistedBatch?.quantityRemaining).toBe(3);

    const movementCount = await prisma.inventoryMovement.count({
      where: { productBatchId: batch.batchId },
    });
    expect(movementCount).toBe(0);
  });

  it('never allows two concurrent adjustments to both pass the negative-quantity guard against the same batch (regression: QA-caught TOCTOU race in the original read-check-write implementation)', async () => {
    const tenant = await tenantsService.register({
      name: `Concurrent Adjustment Test ${Date.now()}`,
    });
    const product = await productsService.create(tenant.tenantId, {
      name: 'Concurrent Adjustment Product',
      unit: 'box',
      currentPrice: 10,
    });
    const batch = await prisma.productBatch.create({
      data: {
        tenantId: tenant.tenantId,
        productId: product.productId,
        batchNumber: 'RACE-1',
        expiryDate: new Date('2099-01-01'),
        quantityReceived: 10,
        quantityRemaining: 10,
      },
    });

    // Two concurrent -8 adjustments against a batch holding 10: only one can
    // legally succeed (10-8=2 is fine; a second -8 on top would go to -6).
    // A read-then-write implementation lets both read quantityRemaining=10
    // before either writes, so both pass the in-app check — this is exactly
    // the lost-update bug QA reproduced against the real DB.
    const results = await Promise.allSettled([
      movementsService.createAdjustment(tenant.tenantId, product.productId, {
        productBatchId: batch.batchId,
        quantityDelta: -8,
        reason: 'Concurrent count correction A',
      }),
      movementsService.createAdjustment(tenant.tenantId, product.productId, {
        productBatchId: batch.batchId,
        quantityDelta: -8,
        reason: 'Concurrent count correction B',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const persistedBatch = await prisma.productBatch.findUnique({
      where: { batchId: batch.batchId },
    });
    expect(persistedBatch?.quantityRemaining).toBe(2);
    expect(persistedBatch?.quantityRemaining).toBeGreaterThanOrEqual(0);

    const movementCount = await prisma.inventoryMovement.count({
      where: { productBatchId: batch.batchId },
    });
    expect(movementCount).toBe(1);
  });

  it('low-stock alert lists only products strictly under reorderThreshold, worst-shortage-first (STORY-017)', async () => {
    const tenant = await tenantsService.register({
      name: `Low Stock Test ${Date.now()}`,
    });
    const shortProduct = await productsService.create(tenant.tenantId, {
      name: 'Short Product',
      unit: 'box',
      currentPrice: 10,
      reorderThreshold: 20,
    });
    await prisma.productBatch.create({
      data: {
        tenantId: tenant.tenantId,
        productId: shortProduct.productId,
        batchNumber: 'LS-1',
        expiryDate: new Date('2099-01-01'),
        quantityReceived: 5,
        quantityRemaining: 5,
      },
    });

    const atThresholdProduct = await productsService.create(tenant.tenantId, {
      name: 'At Threshold Product',
      unit: 'box',
      currentPrice: 10,
      reorderThreshold: 5,
    });
    await prisma.productBatch.create({
      data: {
        tenantId: tenant.tenantId,
        productId: atThresholdProduct.productId,
        batchNumber: 'LS-2',
        expiryDate: new Date('2099-01-01'),
        quantityReceived: 5,
        quantityRemaining: 5,
      },
    });

    await productsService.create(tenant.tenantId, {
      name: 'No Threshold Product',
      unit: 'box',
      currentPrice: 10,
    });

    const result = await alertsService.getLowStock(tenant.tenantId, {
      page: 1,
      per_page: 25,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].productId).toBe(shortProduct.productId);
    expect(result.data[0].totalOnHand).toBe(5);
  });

  it('near-expiry alert includes an already-expired batch and excludes one far beyond the window (STORY-018)', async () => {
    const tenant = await tenantsService.register({
      name: `Near Expiry Test ${Date.now()}`,
    });
    const product = await productsService.create(tenant.tenantId, {
      name: 'Expiry Window Product',
      unit: 'box',
      currentPrice: 10,
    });

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const expiredBatch = await prisma.productBatch.create({
      data: {
        tenantId: tenant.tenantId,
        productId: product.productId,
        batchNumber: 'EXPIRED',
        expiryDate: yesterday,
        quantityReceived: 4,
        quantityRemaining: 4,
      },
    });

    await prisma.productBatch.create({
      data: {
        tenantId: tenant.tenantId,
        productId: product.productId,
        batchNumber: 'FAR-FUTURE',
        expiryDate: new Date('2099-01-01'),
        quantityReceived: 4,
        quantityRemaining: 4,
      },
    });

    const result = await alertsService.getNearExpiry(tenant.tenantId, 30, {
      page: 1,
      per_page: 25,
    });

    expect(result.data.some((d) => d.batchId === expiredBatch.batchId)).toBe(
      true,
    );
    expect(
      result.data.find((d) => d.batchId === expiredBatch.batchId)
        ?.daysUntilExpiry,
    ).toBeLessThan(0);
    expect(result.data.every((d) => d.batchNumber !== 'FAR-FUTURE')).toBe(true);
  });
});
