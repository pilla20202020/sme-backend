import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CatalogImportService } from './catalog-import.service';

function decimal(n: number) {
  return { toNumber: () => n };
}

const mockCategoriesService = {
  findOrCreateByName: jest.fn(),
};

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
  product: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  productPriceHistory: {
    create: jest.fn(),
  },
  $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
};

const makeService = () =>
  new CatalogImportService(mockPrisma as never, mockCategoriesService as never);

beforeEach(() => {
  jest.clearAllMocks();

  mockCategoriesService.findOrCreateByName.mockResolvedValue({ categoryId: 5 });
  mockPrisma.tenant.findUnique.mockResolvedValue({ tenantId: 1 });
  mockPrisma.product.findFirst.mockResolvedValue(null);
  mockPrisma.product.create.mockResolvedValue({ productId: 1 });
  mockPrisma.product.update.mockResolvedValue({ productId: 1 });
  mockPrisma.productPriceHistory.create.mockResolvedValue({ id: 1n });
  mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
    Promise.all(ops),
  );
});

describe('CatalogImportService', () => {
  it('rejects a non-array body', async () => {
    await expect(
      makeService().importProducts(1, { not: 'an array' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException up front when the tenant does not exist, instead of failing every row individually', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await expect(
      makeService().importProducts(999, [
        { name: 'Product A', unit: 'tablet', currentPrice: 1 },
      ]),
    ).rejects.toThrow(NotFoundException);
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });

  it('processes every row independently — 3 good rows create, 1 bad row fails, and nothing aborts', async () => {
    const rows = [
      { name: 'Product A', unit: 'tablet', currentPrice: 1 },
      { name: 'Product B', unit: 'capsule', currentPrice: 2 },
      { name: '', unit: 'tablet', currentPrice: 3 }, // invalid: empty name
      { name: 'Product D', unit: 'bottle', currentPrice: 4 },
    ];

    const result = await makeService().importProducts(1, rows);

    expect(result.created).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].row).toBe(3);
    expect(result.failed[0].errors.length).toBeGreaterThan(0);
    expect(mockPrisma.product.create).toHaveBeenCalledTimes(3);
  });

  it('rejects a row with an unknown unit and reports it without aborting others', async () => {
    const rows = [
      { name: 'Good', unit: 'tablet', currentPrice: 1 },
      { name: 'Bad Unit', unit: 'kg', currentPrice: 1 },
    ];

    const result = await makeService().importProducts(1, rows);

    expect(result.created).toBe(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ row: 2 }) as never,
    ]);
  });

  it('auto-creates a category that does not exist yet (AC-3)', async () => {
    const rows = [
      {
        name: 'Product A',
        unit: 'tablet',
        currentPrice: 1,
        categoryName: 'Brand New Category',
      },
    ];

    await makeService().importProducts(1, rows);

    expect(mockCategoriesService.findOrCreateByName).toHaveBeenCalledWith(
      1,
      'Brand New Category',
    );
    expect(mockPrisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ categoryId: 5 }) as never,
      }),
    );
  });

  it('updates an existing product matched by sku instead of creating a duplicate', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({
      productId: 9,
      currentPrice: decimal(1.5),
    });

    const rows = [
      { name: 'Existing', sku: 'SKU-1', unit: 'tablet', currentPrice: 1.5 },
    ];

    const result = await makeService().importProducts(1, rows);

    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productId: 9 } }),
    );
    // Price unchanged — no transaction/history row needed.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('preserves an existing product’s categoryId/reorderThreshold when the import row omits them (regression)', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({
      productId: 9,
      currentPrice: decimal(1.5),
    });

    const rows = [
      // No categoryName, no reorderThreshold — must NOT wipe the existing
      // product's values to null. Previously did, silently, on every
      // re-import row that omitted these optional columns.
      { name: 'Existing', sku: 'SKU-1', unit: 'tablet', currentPrice: 1.5 },
    ];

    await makeService().importProducts(1, rows);

    const updateCall = (
      mockPrisma.product.update.mock.calls as [
        { data: Record<string, unknown> },
      ][]
    )[0][0];
    expect(updateCall.data).not.toHaveProperty('categoryId');
    expect(updateCall.data).not.toHaveProperty('reorderThreshold');
  });

  it('does update categoryId/reorderThreshold when the import row explicitly provides them', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({
      productId: 9,
      currentPrice: decimal(1.5),
    });

    const rows = [
      {
        name: 'Existing',
        sku: 'SKU-1',
        unit: 'tablet',
        currentPrice: 1.5,
        categoryName: 'New Category',
        reorderThreshold: 20,
      },
    ];

    await makeService().importProducts(1, rows);

    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          categoryId: 5,
          reorderThreshold: 20,
        }) as never,
      }),
    );
  });

  it('routes a price change on an updated row through the transactional history append', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({
      productId: 9,
      currentPrice: decimal(1.5),
    });

    const rows = [
      { name: 'Existing', sku: 'SKU-1', unit: 'tablet', currentPrice: 3.0 },
    ];

    const result = await makeService().importProducts(1, rows);

    expect(result.updated).toBe(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.productPriceHistory.create).toHaveBeenCalledWith({
      data: { productId: 9, price: 3.0 },
    });
  });

  it('catches a per-row processing error and reports it without aborting the import', async () => {
    mockPrisma.product.create.mockRejectedValueOnce(new Error('db exploded'));

    const rows = [
      { name: 'Boom', unit: 'tablet', currentPrice: 1 },
      { name: 'Fine', unit: 'tablet', currentPrice: 1 },
    ];

    const result = await makeService().importProducts(1, rows);

    expect(result.created).toBe(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ row: 1, errors: ['db exploded'] }) as never,
    ]);
  });

  it('summarizes created/updated/failed counts (AC-2)', async () => {
    // Only row 2 (the one with a sku) triggers a findFirst lookup at all —
    // row 1 has no sku (always creates) and row 3 fails validation before
    // ever reaching the sku lookup.
    mockPrisma.product.findFirst.mockResolvedValueOnce({
      productId: 9,
      currentPrice: decimal(1),
    });

    const rows = [
      { name: 'New Product', unit: 'tablet', currentPrice: 1 },
      { name: 'Existing', sku: 'SKU-1', unit: 'tablet', currentPrice: 1 },
      { name: '', unit: 'tablet', currentPrice: 1 },
    ];

    const result = await makeService().importProducts(1, rows);

    expect(result).toEqual(
      expect.objectContaining({ created: 1, updated: 1 }) as never,
    );
    expect(result.failed).toHaveLength(1);
  });
});
