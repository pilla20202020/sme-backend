import 'dotenv/config';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../catalog/products.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { TenantsService } from '../tenants/tenants.service';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Proves STORY-012 AC-2 end to end against the REAL local database: a
 * PurchaseOrderLine's unitCost/productId are frozen at creation time and
 * stay frozen even after the referenced Product's currentPrice changes
 * later. A mocked-Prisma unit test can only prove the mapping code never
 * *reads* Product.currentPrice; this test additionally proves the DB row
 * itself is genuinely unaffected by a real ProductsService.updatePrice()
 * call, closing the gap a mock can't (mirrors the real-DB pattern already
 * established by src/auth/rbac-enforcement.spec.ts).
 */
describe('PurchaseOrdersService — unitCost freeze (real DB, STORY-012 AC-2)', () => {
  let prisma: PrismaService;
  let tenantsService: TenantsService;
  let suppliersService: SuppliersService;
  let productsService: ProductsService;
  let purchaseOrdersService: PurchaseOrdersService;

  beforeAll(() => {
    prisma = new PrismaService();
    tenantsService = new TenantsService(prisma);
    suppliersService = new SuppliersService(prisma);
    productsService = new ProductsService(prisma);
    purchaseOrdersService = new PurchaseOrdersService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps a PO line's unitCost unchanged after the referenced product's currentPrice changes later", async () => {
    const tenant = await tenantsService.register({
      name: `PO Freeze Test ${Date.now()}`,
    });
    const supplier = await suppliersService.create(tenant.tenantId, {
      name: 'Freeze Test Supplier',
    });
    const product = await productsService.create(tenant.tenantId, {
      name: 'Freeze Test Product',
      unit: 'tablet',
      currentPrice: 10,
    });

    const po = await purchaseOrdersService.create(tenant.tenantId, {
      supplierId: supplier.supplierId,
      lines: [
        { productId: product.productId, quantityOrdered: 5, unitCost: 8.5 },
      ],
    });

    expect(po.lines[0].unitCost).toBe(8.5);
    expect(po.status).toBe('pending');
    expect(po.lines[0].quantityReceived).toBe(0);

    // The referenced product's price changes AFTER the PO already exists.
    await productsService.updatePrice(tenant.tenantId, product.productId, {
      price: 99.99,
    });

    const refreshedProduct = await productsService.findById(
      tenant.tenantId,
      product.productId,
    );
    expect(refreshedProduct.currentPrice).toBe(99.99);

    const fetchedPo = await purchaseOrdersService.findById(
      tenant.tenantId,
      po.purchaseOrderId,
    );
    expect(fetchedPo.lines[0].unitCost).toBe(8.5);
    expect(fetchedPo.lines[0].productId).toBe(product.productId);
  });
});
