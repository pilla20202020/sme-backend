import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductsService } from './products.service';

function decimal(n: number) {
  return { toNumber: () => n };
}

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '0.0.0',
    meta: { target },
  });
}

const RAW_PRODUCT = {
  productId: 1,
  tenantId: 1,
  categoryId: null,
  name: 'Paracetamol 500mg',
  sku: 'PARA-500',
  unit: 'tablet',
  currentPrice: decimal(1.5),
  reorderThreshold: 10,
  isActive: true,
  createdAt: new Date(2026, 0, 1, 9, 0),
  updatedAt: new Date(2026, 0, 2, 9, 0),
};

const RAW_PRICE_HISTORY = {
  id: 1n,
  productId: 1,
  price: decimal(1.5),
  effectiveFrom: new Date(2026, 0, 2, 9, 0),
  changedBy: 7,
  createdAt: new Date(2026, 0, 2, 9, 0),
};

const mockPrisma = {
  tenant: { findUnique: jest.fn() },
  category: { findFirst: jest.fn() },
  product: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  productPriceHistory: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
};

const makeService = () => new ProductsService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();

  mockPrisma.tenant.findUnique.mockResolvedValue({ tenantId: 1 });
  mockPrisma.category.findFirst.mockResolvedValue({ categoryId: 2 });
  mockPrisma.product.create.mockResolvedValue(RAW_PRODUCT);
  mockPrisma.product.findFirst.mockResolvedValue(RAW_PRODUCT);
  mockPrisma.product.findMany.mockResolvedValue([RAW_PRODUCT]);
  mockPrisma.product.count.mockResolvedValue(1);
  mockPrisma.product.update.mockResolvedValue(RAW_PRODUCT);
  mockPrisma.productPriceHistory.create.mockResolvedValue(RAW_PRICE_HISTORY);
  mockPrisma.productPriceHistory.findMany.mockResolvedValue([
    RAW_PRICE_HISTORY,
  ]);
  mockPrisma.productPriceHistory.count.mockResolvedValue(1);
  mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
    Promise.all(ops),
  );
});

describe('ProductsService', () => {
  describe('create', () => {
    it('creates a product scoped to the given tenant', async () => {
      const result = await makeService().create(1, {
        name: 'Paracetamol 500mg',
        unit: 'tablet',
        currentPrice: 1.5,
      });

      expect(mockPrisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 1,
            currentPrice: 1.5,
          }) as never,
        }),
      );
      expect(result.tenantId).toBe(1);
      expect(result.currentPrice).toBe(1.5);
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        makeService().create(999, {
          name: 'X',
          unit: 'tablet',
          currentPrice: 1,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.product.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when categoryId does not belong to the tenant', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(null);

      await expect(
        makeService().create(1, {
          name: 'X',
          unit: 'tablet',
          currentPrice: 1,
          categoryId: 99,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.product.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when sku already used in this tenant (P2002)', async () => {
      mockPrisma.product.create.mockRejectedValue(p2002(['tenant_id', 'sku']));

      await expect(
        makeService().create(1, {
          name: 'X',
          unit: 'tablet',
          currentPrice: 1,
          sku: 'DUP',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it('returns the product when it belongs to the given tenant', async () => {
      const result = await makeService().findById(1, 1);

      expect(mockPrisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productId: 1, tenantId: 1 } }),
      );
      expect(result.productId).toBe(1);
    });

    it('throws NotFoundException for a product belonging to a different tenant', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(makeService().findById(1, 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('scopes the query to the tenant', async () => {
      await makeService().findAll(1, { page: 1, per_page: 25 });

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 1 } }),
      );
    });

    it('adds a categoryId filter when provided', async () => {
      await makeService().findAll(1, { page: 1, per_page: 25 }, 2);

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 1, categoryId: 2 } }),
      );
    });

    it('adds a case-insensitive name/sku OR filter when search is provided', async () => {
      await makeService().findAll(
        1,
        { page: 1, per_page: 25 },
        undefined,
        'para',
      );

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 1,
            OR: [
              { name: { contains: 'para', mode: 'insensitive' } },
              { sku: { contains: 'para', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('combines categoryId and search as AND, never overriding categoryId', async () => {
      await makeService().findAll(1, { page: 1, per_page: 25 }, 2, 'para');

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 1,
            categoryId: 2,
            OR: [
              { name: { contains: 'para', mode: 'insensitive' } },
              { sku: { contains: 'para', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });
  });

  describe('update', () => {
    it('updates the declared fields only', async () => {
      await makeService().update(1, 1, { name: 'New Name' });

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { productId: 1 },
        data: { name: 'New Name' },
      });
    });

    it('throws NotFoundException when the product does not belong to the tenant', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(makeService().update(1, 999, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.product.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when categoryId does not belong to the tenant', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(null);

      await expect(
        makeService().update(1, 1, { categoryId: 99 }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.product.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException on a duplicate-sku P2002', async () => {
      mockPrisma.product.update.mockRejectedValue(p2002(['tenant_id', 'sku']));

      await expect(makeService().update(1, 1, { sku: 'DUP' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('updatePrice', () => {
    it('updates currentPrice and appends a ProductPriceHistory row in the same transaction', async () => {
      const result = await makeService().updatePrice(1, 1, { price: 2.25 }, 7);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { productId: 1 },
        data: { currentPrice: 2.25 },
      });
      expect(mockPrisma.productPriceHistory.create).toHaveBeenCalledWith({
        data: { productId: 1, price: 2.25, changedBy: 7 },
      });
      expect(result.productId).toBe(1);
    });

    it('records a null changedBy when no user id is supplied', async () => {
      await makeService().updatePrice(1, 1, { price: 2.25 });

      expect(mockPrisma.productPriceHistory.create).toHaveBeenCalledWith({
        data: { productId: 1, price: 2.25, changedBy: null },
      });
    });

    it('throws NotFoundException when the product does not belong to the tenant', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(
        makeService().updatePrice(1, 999, { price: 2.25 }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getPriceHistory', () => {
    it('orders by effectiveFrom desc and scopes to the product', async () => {
      const result = await makeService().getPriceHistory(1, 1, {
        page: 1,
        per_page: 25,
      });

      expect(mockPrisma.productPriceHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: 1 },
          orderBy: { effectiveFrom: 'desc' },
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('1');
    });

    it('throws NotFoundException when the product does not belong to the tenant', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(makeService().getPriceHistory(1, 999, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
