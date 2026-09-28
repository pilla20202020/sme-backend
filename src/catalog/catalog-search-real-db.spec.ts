import 'dotenv/config';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { ProductsService } from './products.service';

/**
 * Proves SPRINT-008's `search` addition end to end against the REAL local
 * database (mirrors the real-DB pattern established by
 * src/inventory/inventory-management-real-db.spec.ts): a search term matches
 * on Product.name OR Product.sku, case-insensitively, excludes non-matching
 * products, and combines with categoryId as AND (never overriding it).
 */
describe('Catalog product search (real DB)', () => {
  let prisma: PrismaService;
  let tenantsService: TenantsService;
  let productsService: ProductsService;

  beforeAll(() => {
    prisma = new PrismaService();
    tenantsService = new TenantsService(prisma);
    productsService = new ProductsService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('matches on name OR sku, case-insensitively, and excludes non-matches', async () => {
    const tenant = await tenantsService.register({
      name: `Catalog Search Test ${Date.now()}`,
    });

    const byName = await productsService.create(tenant.tenantId, {
      name: 'Paracetamol 500mg',
      unit: 'tablet',
      currentPrice: 1.5,
      sku: 'UNRELATED-SKU-1',
    });
    const bySku = await productsService.create(tenant.tenantId, {
      name: 'Unrelated Name',
      unit: 'tablet',
      currentPrice: 2,
      sku: 'PARA-500',
    });
    const nonMatch = await productsService.create(tenant.tenantId, {
      name: 'Ibuprofen 200mg',
      unit: 'tablet',
      currentPrice: 3,
      sku: 'IBU-200',
    });

    const result = await productsService.findAll(
      tenant.tenantId,
      { page: 1, per_page: 25 },
      undefined,
      'PARA',
    );

    const ids = result.data.map((p) => p.productId);
    expect(ids).toContain(byName.productId);
    expect(ids).toContain(bySku.productId);
    expect(ids).not.toContain(nonMatch.productId);
    expect(result.data).toHaveLength(2);
  });

  it('combines search with categoryId as AND, not OR', async () => {
    const tenant = await tenantsService.register({
      name: `Catalog Search AND Test ${Date.now()}`,
    });
    const category = await prisma.category.create({
      data: { tenantId: tenant.tenantId, name: 'Analgesics' },
    });
    const otherCategory = await prisma.category.create({
      data: { tenantId: tenant.tenantId, name: 'Antibiotics' },
    });

    const inCategoryMatch = await productsService.create(tenant.tenantId, {
      name: 'Paracetamol 500mg',
      unit: 'tablet',
      currentPrice: 1.5,
      categoryId: category.categoryId,
    });
    // Same search term but a different category — must be excluded once
    // categoryId is also supplied (AND semantics, categoryId never
    // overridden by search).
    await productsService.create(tenant.tenantId, {
      name: 'Paracetamol Syrup',
      unit: 'ml',
      currentPrice: 4,
      categoryId: otherCategory.categoryId,
    });

    const result = await productsService.findAll(
      tenant.tenantId,
      { page: 1, per_page: 25 },
      category.categoryId,
      'paracetamol',
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].productId).toBe(inCategoryMatch.productId);
  });
});
