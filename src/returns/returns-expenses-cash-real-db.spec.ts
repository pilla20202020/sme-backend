import 'dotenv/config';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../catalog/products.service';
import { BranchesService } from '../branches/branches.service';
import { TenantsService } from '../tenants/tenants.service';
import { SalesService } from '../sales/sales.service';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { ReturnsService } from './returns.service';
import { ExpensesService } from '../expenses/expenses.service';
import { CashService } from '../cash/cash.service';

/**
 * Proves Sprint 6's core claims end to end against the REAL local database
 * (mirrors the real-DB pattern established by
 * src/sales/sales-real-db.spec.ts): a matched return reverses the exact
 * SaleLineBatchAllocation it targets and writes a `return`-type
 * InventoryMovement (STORY-023 AC); an over-return attempt against the same
 * allocation is rejected with 409 and writes nothing further; a manager-
 * override unmatched return is rejected with 403 when the named approver
 * lacks `returns:override`; and the daily cash endpoint reproduces the
 * PRD §7 worked example (500 sales, 50 return, 100 expense -> 350 net).
 */
describe('Returns / Expenses / Cash (real DB)', () => {
  let prisma: PrismaService;
  let tenantsService: TenantsService;
  let productsService: ProductsService;
  let branchesService: BranchesService;
  let movementsService: InventoryMovementsService;
  let salesService: SalesService;
  let returnsService: ReturnsService;
  let expensesService: ExpensesService;
  let cashService: CashService;

  beforeAll(() => {
    prisma = new PrismaService();
    tenantsService = new TenantsService(prisma);
    productsService = new ProductsService(prisma);
    branchesService = new BranchesService(prisma);
    movementsService = new InventoryMovementsService(prisma);
    salesService = new SalesService(prisma, movementsService);
    returnsService = new ReturnsService(prisma);
    expensesService = new ExpensesService(prisma);
    cashService = new CashService(prisma);
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

  /** Assigns an existing global Role (seeded) to a freshly-created user in
   * the given tenant — used to exercise the real `returns:override`
   * permission check against real Role/RolePermission rows, not a mock. */
  async function makeUserWithRole(tenantId: number, roleName: string) {
    const role = await prisma.role.findFirst({ where: { roleName } });
    if (!role) {
      throw new Error(
        `Role "${roleName}" not found — did the seed run? (npx prisma db seed)`,
      );
    }
    const user = await prisma.user.create({
      data: {
        tenantId,
        email: `${roleName}-${Date.now()}-${Math.random()}@example.com`,
        firstName: roleName,
        lastName: 'Tester',
        isActive: true,
      },
    });
    await prisma.userRole.create({
      data: { userId: user.userId, roleId: role.roleId },
    });
    return user;
  }

  it("a matched return reverses the exact SaleLineBatchAllocation it targets: increments that batch's quantityRemaining and writes a return-type InventoryMovement (STORY-023 AC)", async () => {
    const { tenant, product } = await makeTenantAndProduct(
      'Return Core Test',
      20,
    );
    const batch = await makeBatch(
      tenant.tenantId,
      product.productId,
      'RET-1',
      '2099-01-01',
      10,
    );

    const sale = await salesService.checkout(tenant.tenantId, {
      lines: [{ productId: product.productId, quantity: 4 }],
    });

    const allocation = await prisma.saleLineBatchAllocation.findFirst({
      where: { productBatchId: batch.batchId },
    });
    expect(allocation).not.toBeNull();

    const result = await returnsService.create(
      tenant.tenantId,
      {
        saleId: sale.saleId,
        reason: 'Damaged on delivery',
        lines: [{ saleLineBatchAllocationId: allocation!.id, quantity: 2 }],
      },
      undefined,
    );

    expect(result.refundTotal).toBe(40); // 2 units * unitPrice 20, frozen from the sale
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].productBatchId).toBe(batch.batchId);

    const persistedBatch = await prisma.productBatch.findUnique({
      where: { batchId: batch.batchId },
    });
    // Sale drew 4 (10 -> 6); return credits 2 back (6 -> 8).
    expect(persistedBatch?.quantityRemaining).toBe(8);

    const movements = await prisma.inventoryMovement.findMany({
      where: { tenantId: tenant.tenantId, movementType: 'return' },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].quantityDelta).toBe(2);
    expect(movements[0].productBatchId).toBe(batch.batchId);
    expect(movements[0].referenceType).toBe('ReturnLine');
    expect(movements[0].referenceId).toBe(result.lines[0].returnLineId);
  });

  it('rejects a second, sequential over-return attempt against one allocation with 409, and writes no further ReturnLine/movement (STORY-023 AC — the simple sequential case; see the next test for genuine concurrency)', async () => {
    const { tenant, product } = await makeTenantAndProduct(
      'Over Return Test',
      10,
    );
    const batch = await makeBatch(
      tenant.tenantId,
      product.productId,
      'OR-1',
      '2099-01-01',
      10,
    );

    const sale = await salesService.checkout(tenant.tenantId, {
      lines: [{ productId: product.productId, quantity: 3 }],
    });
    const allocation = await prisma.saleLineBatchAllocation.findFirst({
      where: { productBatchId: batch.batchId },
    });

    // First return of 2 (of the allocation's 3) succeeds.
    await returnsService.create(tenant.tenantId, {
      saleId: sale.saleId,
      reason: 'Partial return',
      lines: [{ saleLineBatchAllocationId: allocation!.id, quantity: 2 }],
    });

    // A second return of 2 more would push the allocation's total returned
    // to 4, exceeding its original quantity of 3 — must be rejected.
    await expect(
      returnsService.create(tenant.tenantId, {
        saleId: sale.saleId,
        reason: 'Second return attempt',
        lines: [{ saleLineBatchAllocationId: allocation!.id, quantity: 2 }],
      }),
    ).rejects.toThrow(ConflictException);

    const returnLineCount = await prisma.returnLine.count({
      where: { saleLineBatchAllocationId: allocation!.id },
    });
    expect(returnLineCount).toBe(1); // only the first, successful return

    const persistedBatch = await prisma.productBatch.findUnique({
      where: { batchId: batch.batchId },
    });
    // Sale drew 3 (10 -> 7); only the first return's +2 landed (7 -> 9) —
    // the rejected second attempt wrote nothing.
    expect(persistedBatch?.quantityRemaining).toBe(9);
  });

  it('never lets two genuinely concurrent returns both pass the over-return guard against the same allocation (regression: QA independently verified the SELECT...FOR UPDATE lock under real Promise.all interleaving, not a sequential await)', async () => {
    const { tenant, product } = await makeTenantAndProduct(
      'Concurrent Over Return Test',
      10,
    );
    await makeBatch(
      tenant.tenantId,
      product.productId,
      'COR-1',
      '2099-01-01',
      10,
    );

    const sale = await salesService.checkout(tenant.tenantId, {
      lines: [{ productId: product.productId, quantity: 5 }],
    });
    const allocation = await prisma.saleLineBatchAllocation.findFirst({
      where: { saleLine: { saleId: sale.saleId } },
    });

    // Two concurrent returns of 3 each against an allocation of 5: neither
    // request alone exceeds 5, but 3+3=6 does — only one may legally land.
    const results = await Promise.allSettled([
      returnsService.create(tenant.tenantId, {
        saleId: sale.saleId,
        reason: 'Concurrent return A',
        lines: [{ saleLineBatchAllocationId: allocation!.id, quantity: 3 }],
      }),
      returnsService.create(tenant.tenantId, {
        saleId: sale.saleId,
        reason: 'Concurrent return B',
        lines: [{ saleLineBatchAllocationId: allocation!.id, quantity: 3 }],
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const returnLines = await prisma.returnLine.findMany({
      where: { saleLineBatchAllocationId: allocation!.id },
    });
    expect(returnLines).toHaveLength(1);
    const totalReturned = returnLines.reduce((sum, l) => sum + l.quantity, 0);
    expect(totalReturned).toBeLessThanOrEqual(allocation!.quantity);
    expect(totalReturned).toBe(3);
  });

  it('rejects a manager-override unmatched return with 403 when overrideApprovedBy names a user who lacks returns:override (a cashier), and accepts it when the named user is a manager (STORY-024 AC)', async () => {
    const { tenant, product } = await makeTenantAndProduct('Override Test', 15);
    const batch = await makeBatch(
      tenant.tenantId,
      product.productId,
      'OV-1',
      '2099-01-01',
      10,
    );

    const cashier = await makeUserWithRole(tenant.tenantId, 'cashier');
    const manager = await makeUserWithRole(tenant.tenantId, 'manager');

    await expect(
      returnsService.create(tenant.tenantId, {
        reason: 'No receipt on file',
        overrideApprovedBy: cashier.userId,
        lines: [
          {
            productId: product.productId,
            productBatchId: batch.batchId,
            quantity: 1,
            unitPrice: 15,
          },
        ],
      }),
    ).rejects.toThrow(ForbiddenException);

    const noWrite = await prisma.return.count({
      where: { tenantId: tenant.tenantId },
    });
    expect(noWrite).toBe(0);

    const result = await returnsService.create(tenant.tenantId, {
      reason: 'No receipt on file',
      overrideApprovedBy: manager.userId,
      lines: [
        {
          productId: product.productId,
          productBatchId: batch.batchId,
          quantity: 1,
          unitPrice: 15,
        },
      ],
    });

    expect(result.saleId).toBeNull();
    expect(result.overrideApprovedBy).toBe(manager.userId);
    expect(result.refundTotal).toBe(15);

    const persistedBatch = await prisma.productBatch.findUnique({
      where: { batchId: batch.batchId },
    });
    expect(persistedBatch?.quantityRemaining).toBe(11); // 10 + 1, no original sale to draw down first
  });

  it('daily cash reconciliation reproduces the PRD §7 worked example: 500 in sales, 50 returned, 100 expensed -> netCashPosition 350 (STORY-026 AC)', async () => {
    const { tenant, product } = await makeTenantAndProduct('Cash Test', 50);
    const branch = await branchesService.create(tenant.tenantId, {
      name: 'Main Branch',
    });
    await makeBatch(
      tenant.tenantId,
      product.productId,
      'CASH-1',
      '2099-01-01',
      20,
    );

    const fixedDay = new Date('2026-06-15T12:00:00.000Z');
    const dateStr = '2026-06-15';

    const sale1 = await salesService.checkout(tenant.tenantId, {
      lines: [{ productId: product.productId, quantity: 6 }], // 6 * 50 = 300
    });
    const sale2 = await salesService.checkout(tenant.tenantId, {
      lines: [{ productId: product.productId, quantity: 4 }], // 4 * 50 = 200
    });
    await prisma.sale.update({
      where: { saleId: sale1.saleId },
      data: { saleDate: fixedDay },
    });
    await prisma.sale.update({
      where: { saleId: sale2.saleId },
      data: { saleDate: fixedDay },
    });

    const allocation = await prisma.saleLineBatchAllocation.findFirst({
      where: { saleLine: { saleId: sale1.saleId } },
    });
    const ret = await returnsService.create(tenant.tenantId, {
      saleId: sale1.saleId,
      reason: 'Partial refund',
      lines: [{ saleLineBatchAllocationId: allocation!.id, quantity: 1 }], // 1 * 50 = 50
    });
    await prisma.return.update({
      where: { returnId: ret.returnId },
      data: { returnDate: fixedDay },
    });

    await expensesService.create(tenant.tenantId, {
      branchId: branch.branchId,
      category: 'Utilities',
      amount: 100,
      expenseDate: dateStr,
    });

    const daily = await cashService.getDaily(tenant.tenantId, dateStr);

    expect(daily).toEqual({
      date: dateStr,
      salesTotal: 500,
      returnsTotal: 50,
      expensesTotal: 100,
      netCashPosition: 350,
      saleCount: 2,
      returnCount: 1,
      expenseCount: 1,
    });
  });
});
