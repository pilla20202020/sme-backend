import 'dotenv/config';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../catalog/products.service';
import { CustomersService } from '../customers/customers.service';
import { TenantsService } from '../tenants/tenants.service';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { SalesService } from './sales.service';

/**
 * Proves STORY-019..022's core claims end to end against the REAL local
 * database (mirrors the real-DB pattern established by
 * src/inventory/inventory-management-real-db.spec.ts): a quote never writes
 * anything, checkout draws stock First-Expiry-First-Out and can span
 * multiple batches (the PRD §7 spillover AC), an oversell attempt is
 * rejected with 409 and writes nothing, the receipt/get-sale endpoints
 * return the itemized shape, and two concurrent checkouts racing for the
 * same limited batch stock can never both succeed nor drive a batch
 * negative (the STORY-021 analogue of Sprint 4's adjustment-race
 * regression).
 */
describe('Sales / POS (real DB)', () => {
  let prisma: PrismaService;
  let tenantsService: TenantsService;
  let productsService: ProductsService;
  let customersService: CustomersService;
  let movementsService: InventoryMovementsService;
  let salesService: SalesService;

  beforeAll(() => {
    prisma = new PrismaService();
    tenantsService = new TenantsService(prisma);
    productsService = new ProductsService(prisma);
    customersService = new CustomersService(prisma);
    movementsService = new InventoryMovementsService(prisma);
    salesService = new SalesService(prisma, movementsService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeTenantAndProduct(namePrefix: string, currentPrice = 25) {
    const tenant = await tenantsService.register({
      name: `${namePrefix} ${Date.now()}-${Math.random()}`,
    });
    const product = await productsService.create(tenant.tenantId, {
      name: `${namePrefix} Product`,
      unit: 'box',
      currentPrice,
    });
    return { tenant, product };
  }

  async function makeBatch(
    tenantId: number,
    productId: number,
    batchNumber: string,
    expiryDate: string,
    quantity: number,
  ) {
    return prisma.productBatch.create({
      data: {
        tenantId,
        productId,
        batchNumber,
        expiryDate: new Date(expiryDate),
        quantityReceived: quantity,
        quantityRemaining: quantity,
      },
    });
  }

  it('quote() flags insufficient stock without writing a Sale, SaleLine, or InventoryMovement row (STORY-019)', async () => {
    const { tenant, product } = await makeTenantAndProduct('Quote Test', 15);
    await makeBatch(tenant.tenantId, product.productId, 'Q-1', '2099-01-01', 3);

    const result = await salesService.quote(tenant.tenantId, {
      lines: [{ productId: product.productId, quantity: 10 }],
    });

    expect(result.allSufficient).toBe(false);
    expect(result.lines[0]).toMatchObject({
      available: false,
      totalOnHand: 3,
      unitPrice: 15,
      lineTotal: 150,
    });

    const saleCount = await prisma.sale.count({
      where: { tenantId: tenant.tenantId },
    });
    expect(saleCount).toBe(0);
    const movementCount = await prisma.inventoryMovement.count({
      where: { tenantId: tenant.tenantId },
    });
    expect(movementCount).toBe(0);
  });

  it('checkout() with sufficient stock creates the sale, decrements the batch, and writes one sale movement (STORY-020)', async () => {
    const { tenant, product } = await makeTenantAndProduct('Checkout Test', 20);
    const batch = await makeBatch(
      tenant.tenantId,
      product.productId,
      'CO-1',
      '2099-01-01',
      10,
    );
    const customer = await customersService.create(tenant.tenantId, {
      name: 'Walk-in Regular',
    });

    const result = await salesService.checkout(
      tenant.tenantId,
      {
        customerId: customer.customerId,
        lines: [{ productId: product.productId, quantity: 4 }],
      },
      undefined,
    );

    expect(result.lines).toEqual([
      {
        saleLineId: expect.any(Number) as number,
        productId: product.productId,
        productName: 'Checkout Test Product',
        quantity: 4,
        unitPrice: 20,
        lineTotal: 80,
        allocations: [
          {
            saleLineBatchAllocationId: expect.any(Number) as number,
            quantity: 4,
          },
        ],
      },
    ]);
    expect(result.subtotal).toBe(80);
    expect(result.total).toBe(80);
    expect(result.customer).toEqual({
      customerId: customer.customerId,
      name: 'Walk-in Regular',
    });

    const persistedBatch = await prisma.productBatch.findUnique({
      where: { batchId: batch.batchId },
    });
    expect(persistedBatch?.quantityRemaining).toBe(6);

    const movements = await prisma.inventoryMovement.findMany({
      where: { tenantId: tenant.tenantId, movementType: 'sale' },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].quantityDelta).toBe(-4);
    expect(movements[0].productBatchId).toBe(batch.batchId);
    expect(movements[0].referenceType).toBe('SaleLineBatchAllocation');

    const allocation = await prisma.saleLineBatchAllocation.findFirst({
      where: { productBatchId: batch.batchId },
    });
    expect(allocation?.quantity).toBe(4);
    expect(movements[0].referenceId).toBe(allocation?.id);
  });

  it("a sale's unitPrice/lineTotal stay frozen at their sale-time value even after the product's currentPrice changes later (PRD §3 'freeze at transaction time' principle — QA-flagged gap)", async () => {
    const { tenant, product } = await makeTenantAndProduct(
      'Price Freeze Test',
      50,
    );
    await makeBatch(
      tenant.tenantId,
      product.productId,
      'PF-1',
      '2099-01-01',
      10,
    );

    const sale = await salesService.checkout(
      tenant.tenantId,
      { lines: [{ productId: product.productId, quantity: 2 }] },
      undefined,
    );
    expect(sale.lines[0].unitPrice).toBe(50);
    expect(sale.lines[0].lineTotal).toBe(100);
    expect(sale.subtotal).toBe(100);

    await productsService.updatePrice(tenant.tenantId, product.productId, {
      price: 999,
    });

    const refetchedSale = await salesService.getSale(
      tenant.tenantId,
      sale.saleId,
    );
    const refetchedReceipt = await salesService.getReceipt(
      tenant.tenantId,
      sale.saleId,
    );

    expect(refetchedSale.lines[0].unitPrice).toBe(50);
    expect(refetchedSale.lines[0].lineTotal).toBe(100);
    expect(refetchedSale.subtotal).toBe(100);
    expect(refetchedReceipt.lines[0].unitPrice).toBe(50);
    expect(refetchedReceipt.subtotal).toBe(100);
  });

  it('FEFO spillover: a quantity spanning two batches draws 3 from the near-expiry batch and 2 from the far one, two allocations and two movements (PRD §7 AC — the story core case)', async () => {
    const { tenant, product } = await makeTenantAndProduct('FEFO Test', 12);
    const nearBatch = await makeBatch(
      tenant.tenantId,
      product.productId,
      'FEFO-NEAR',
      '2026-01-01',
      3,
    );
    const farBatch = await makeBatch(
      tenant.tenantId,
      product.productId,
      'FEFO-FAR',
      '2026-06-01',
      10,
    );

    const result = await salesService.checkout(tenant.tenantId, {
      lines: [{ productId: product.productId, quantity: 5 }],
    });

    expect(result.lines[0].quantity).toBe(5);
    expect(result.lines[0].lineTotal).toBe(60);

    const persistedNear = await prisma.productBatch.findUnique({
      where: { batchId: nearBatch.batchId },
    });
    const persistedFar = await prisma.productBatch.findUnique({
      where: { batchId: farBatch.batchId },
    });
    expect(persistedNear?.quantityRemaining).toBe(0);
    expect(persistedFar?.quantityRemaining).toBe(8);

    const saleLine = await prisma.saleLine.findFirst({
      where: { productId: product.productId },
      include: { allocations: true },
    });
    expect(saleLine?.allocations).toHaveLength(2);
    const byBatch = new Map(
      saleLine!.allocations.map((a) => [a.productBatchId, a.quantity]),
    );
    expect(byBatch.get(nearBatch.batchId)).toBe(3);
    expect(byBatch.get(farBatch.batchId)).toBe(2);

    const movements = await prisma.inventoryMovement.findMany({
      where: { tenantId: tenant.tenantId, movementType: 'sale' },
    });
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => m.quantityDelta).sort()).toEqual(
      [-3, -2].sort(),
    );
  });

  it('an oversell attempt is rejected with 409 and writes nothing to Sale, SaleLine, or ProductBatch (STORY-020/021 AC)', async () => {
    const { tenant, product } = await makeTenantAndProduct('Oversell Test', 8);
    const batch = await makeBatch(
      tenant.tenantId,
      product.productId,
      'OS-1',
      '2099-01-01',
      5,
    );

    await expect(
      salesService.checkout(tenant.tenantId, {
        lines: [{ productId: product.productId, quantity: 9 }],
      }),
    ).rejects.toThrow(/Insufficient stock/);

    const saleCount = await prisma.sale.count({
      where: { tenantId: tenant.tenantId },
    });
    expect(saleCount).toBe(0);

    const persistedBatch = await prisma.productBatch.findUnique({
      where: { batchId: batch.batchId },
    });
    expect(persistedBatch?.quantityRemaining).toBe(5);

    const movementCount = await prisma.inventoryMovement.count({
      where: { tenantId: tenant.tenantId },
    });
    expect(movementCount).toBe(0);
  });

  it('a checkout spanning two lines rolls back entirely (including the first, already-satisfiable line) when a later line oversells — a sale is never partially filled (STORY-020 AC)', async () => {
    const { tenant, product: productA } = await makeTenantAndProduct(
      'Rollback Test A',
      5,
    );
    const productB = await productsService.create(tenant.tenantId, {
      name: 'Rollback Test B Product',
      unit: 'box',
      currentPrice: 5,
    });
    await makeBatch(
      tenant.tenantId,
      productA.productId,
      'RB-A',
      '2099-01-01',
      10,
    );
    await makeBatch(
      tenant.tenantId,
      productB.productId,
      'RB-B',
      '2099-01-01',
      1,
    );

    await expect(
      salesService.checkout(tenant.tenantId, {
        lines: [
          { productId: productA.productId, quantity: 5 }, // satisfiable alone
          { productId: productB.productId, quantity: 9 }, // not satisfiable
        ],
      }),
    ).rejects.toThrow(/Insufficient stock/);

    expect(
      await prisma.sale.count({ where: { tenantId: tenant.tenantId } }),
    ).toBe(0);
    const batchA = await prisma.productBatch.findFirst({
      where: { productId: productA.productId },
    });
    expect(batchA?.quantityRemaining).toBe(10); // untouched — not decremented
  });

  it('GET-sale and receipt return the same itemized shape (STORY-022 — one mapSaleReceipt reused everywhere)', async () => {
    const { tenant, product } = await makeTenantAndProduct('Receipt Test', 30);
    await makeBatch(
      tenant.tenantId,
      product.productId,
      'RCPT-1',
      '2099-01-01',
      10,
    );

    const checkoutResult = await salesService.checkout(tenant.tenantId, {
      lines: [{ productId: product.productId, quantity: 2 }],
    });

    const getSaleResult = await salesService.getSale(
      tenant.tenantId,
      checkoutResult.saleId,
    );
    const receiptResult = await salesService.getReceipt(
      tenant.tenantId,
      checkoutResult.saleId,
    );

    expect(getSaleResult).toEqual(checkoutResult);
    expect(receiptResult).toEqual(checkoutResult);
    expect(receiptResult.lines[0].productName).toBe('Receipt Test Product');
  });

  it('never allows two concurrent checkouts to both draw from the same limited batch beyond what it holds (regression: the STORY-021 analogue of Sprint 4s adjustment-race fix)', async () => {
    const { tenant, product } = await makeTenantAndProduct(
      'Concurrent Checkout Test',
      10,
    );
    const batch = await makeBatch(
      tenant.tenantId,
      product.productId,
      'RACE-SALE-1',
      '2099-01-01',
      10,
    );

    // Two concurrent checkouts for 8 units each against a batch holding 10:
    // only one can legally succeed (10-8=2 fine; a second -8 on top would go
    // to -6). A read-then-write FEFO implementation lets both read
    // quantityRemaining=10 before either writes, so both would pass an
    // in-app sufficiency check — this is exactly the lost-update shape QA
    // caught in Sprint 4's adjustment endpoint, now at checkout-queue stakes.
    const results = await Promise.allSettled([
      salesService.checkout(tenant.tenantId, {
        lines: [{ productId: product.productId, quantity: 8 }],
      }),
      salesService.checkout(tenant.tenantId, {
        lines: [{ productId: product.productId, quantity: 8 }],
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

    const saleCount = await prisma.sale.count({
      where: { tenantId: tenant.tenantId },
    });
    expect(saleCount).toBe(1);

    const movementCount = await prisma.inventoryMovement.count({
      where: { tenantId: tenant.tenantId, movementType: 'sale' },
    });
    expect(movementCount).toBe(1);
  });

  it("a fetched sale's line carries the correct saleLineId and allocation ids/quantities matching what checkout actually created, spanning a FEFO spillover across 2 batches (SPRINT-014 returns UI backend dependency)", async () => {
    const { tenant, product } = await makeTenantAndProduct(
      'Allocation Exposure Test',
      9,
    );
    const nearBatch = await makeBatch(
      tenant.tenantId,
      product.productId,
      'ALLOC-NEAR',
      '2026-01-01',
      3,
    );
    const farBatch = await makeBatch(
      tenant.tenantId,
      product.productId,
      'ALLOC-FAR',
      '2026-06-01',
      10,
    );

    const checkoutResult = await salesService.checkout(tenant.tenantId, {
      lines: [{ productId: product.productId, quantity: 5 }],
    });

    // What checkout actually created, read straight from the DB — the
    // source of truth this test's fetched-sale assertions are checked
    // against.
    const persistedAllocations = await prisma.saleLineBatchAllocation.findMany({
      where: {
        saleLine: { saleId: checkoutResult.saleId },
      },
    });
    expect(persistedAllocations).toHaveLength(2);
    const expectedByBatch = new Map(
      persistedAllocations.map((a) => [a.productBatchId, a]),
    );
    expect(expectedByBatch.get(nearBatch.batchId)?.quantity).toBe(3);
    expect(expectedByBatch.get(farBatch.batchId)?.quantity).toBe(2);

    // The actual claim: GET-sale (and, by the same mapSaleReceipt reuse,
    // the receipt endpoint) now exposes saleLineId + allocations, matching
    // the persisted rows exactly.
    const fetchedSale = await salesService.getSale(
      tenant.tenantId,
      checkoutResult.saleId,
    );
    const fetchedReceipt = await salesService.getReceipt(
      tenant.tenantId,
      checkoutResult.saleId,
    );

    expect(fetchedSale.lines).toHaveLength(1);
    const fetchedLine = fetchedSale.lines[0];
    expect(fetchedLine.saleLineId).toEqual(expect.any(Number) as number);
    expect(fetchedLine.allocations).toHaveLength(2);

    const fetchedByBatch = new Map(
      fetchedLine.allocations.map((a) => [
        persistedAllocations.find((p) => p.id === a.saleLineBatchAllocationId)
          ?.productBatchId,
        a.quantity,
      ]),
    );
    expect(fetchedByBatch.get(nearBatch.batchId)).toBe(3);
    expect(fetchedByBatch.get(farBatch.batchId)).toBe(2);

    // Every allocation id the fetched sale names really is one of the ids
    // checkout persisted — not a coincidentally-matching quantity.
    const persistedIds = new Set(persistedAllocations.map((a) => a.id));
    fetchedLine.allocations.forEach((a) => {
      expect(persistedIds.has(a.saleLineBatchAllocationId)).toBe(true);
    });

    // Receipt (same mapSaleReceipt reuse, PRD §8) exposes the identical
    // fields — never a second, diverging DTO.
    expect(fetchedReceipt.lines[0].allocations).toEqual(
      fetchedLine.allocations,
    );
    expect(fetchedReceipt.lines[0].saleLineId).toBe(fetchedLine.saleLineId);
  });

  it('findAll() excludes a sale outside the requested dateFrom/dateTo range (STORY-028)', async () => {
    const { tenant, product } = await makeTenantAndProduct(
      'Sales Report Test',
      10,
    );
    await makeBatch(
      tenant.tenantId,
      product.productId,
      'RPT-1',
      '2099-01-01',
      50,
    );

    const inRangeSale = await salesService.checkout(tenant.tenantId, {
      lines: [{ productId: product.productId, quantity: 2 }],
    });

    // Pushes this sale's saleDate outside the range that will be queried
    // below — a direct DB update since Sale.saleDate defaults to "now" and
    // isn't settable through the service API.
    const outOfRangeSale = await salesService.checkout(tenant.tenantId, {
      lines: [{ productId: product.productId, quantity: 3 }],
    });
    await prisma.sale.update({
      where: { saleId: outOfRangeSale.saleId },
      data: { saleDate: new Date('2020-01-01T00:00:00.000Z') },
    });

    const result = await salesService.findAll(tenant.tenantId, {
      dateFrom: new Date().getFullYear() + '-01-01',
      dateTo: new Date().getFullYear() + '-12-31',
    });

    const returnedIds = result.data.map((s) => s.saleId);
    expect(returnedIds).toContain(inRangeSale.saleId);
    expect(returnedIds).not.toContain(outOfRangeSale.saleId);
  });
});
