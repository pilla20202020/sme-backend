import { NotFoundException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';

function decimal(n: number) {
  return { toNumber: () => n };
}

const RAW_LINE = {
  lineId: 1,
  purchaseOrderId: 1,
  productId: 1,
  quantityOrdered: 10,
  quantityReceived: 0,
  unitCost: decimal(8.5),
  createdAt: new Date(2026, 0, 1, 9, 0),
  updatedAt: new Date(2026, 0, 1, 9, 0),
};

const RAW_PO = {
  purchaseOrderId: 1,
  tenantId: 1,
  supplierId: 1,
  status: 'pending',
  orderDate: new Date(2026, 0, 1, 9, 0),
  expectedDeliveryDate: null,
  notes: null,
  createdBy: 7,
  createdAt: new Date(2026, 0, 1, 9, 0),
  updatedAt: new Date(2026, 0, 1, 9, 0),
  lines: [RAW_LINE],
};

const mockPrisma = {
  tenant: { findUnique: jest.fn() },
  supplier: { findFirst: jest.fn() },
  product: { findMany: jest.fn() },
  purchaseOrder: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const makeService = () => new PurchaseOrdersService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();

  mockPrisma.tenant.findUnique.mockResolvedValue({ tenantId: 1 });
  mockPrisma.supplier.findFirst.mockResolvedValue({ supplierId: 1 });
  mockPrisma.product.findMany.mockResolvedValue([{ productId: 1 }]);
  mockPrisma.purchaseOrder.create.mockResolvedValue(RAW_PO);
  mockPrisma.purchaseOrder.findFirst.mockResolvedValue(RAW_PO);
  mockPrisma.purchaseOrder.findMany.mockResolvedValue([RAW_PO]);
  mockPrisma.purchaseOrder.count.mockResolvedValue(1);
});

describe('PurchaseOrdersService', () => {
  describe('create', () => {
    it('creates a PO in pending status with all lines at quantityReceived: 0 (AC-1)', async () => {
      const result = await makeService().create(1, {
        supplierId: 1,
        lines: [{ productId: 1, quantityOrdered: 10, unitCost: 8.5 }],
      });

      expect(mockPrisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 1,
            supplierId: 1,
            lines: {
              create: [{ productId: 1, quantityOrdered: 10, unitCost: 8.5 }],
            },
          }) as never,
        }),
      );
      expect(result.status).toBe('pending');
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].quantityReceived).toBe(0);
      expect(result.lines[0].unitCost).toBe(8.5);
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        makeService().create(999, {
          supplierId: 1,
          lines: [{ productId: 1, quantityOrdered: 1, unitCost: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the supplier does not belong to the tenant', async () => {
      mockPrisma.supplier.findFirst.mockResolvedValue(null);

      await expect(
        makeService().create(1, {
          supplierId: 99,
          lines: [{ productId: 1, quantityOrdered: 1, unitCost: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when a line references a product outside the tenant', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);

      await expect(
        makeService().create(1, {
          supplierId: 1,
          lines: [{ productId: 42, quantityOrdered: 1, unitCost: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.purchaseOrder.create).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns the PO with lines when it belongs to the given tenant', async () => {
      const result = await makeService().findById(1, 1);

      expect(mockPrisma.purchaseOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { purchaseOrderId: 1, tenantId: 1 } }),
      );
      expect(result.purchaseOrderId).toBe(1);
      expect(result.lines[0].quantityOrdered).toBe(10);
    });

    it('throws NotFoundException for a PO belonging to a different tenant', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(makeService().findById(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("never derives a line's unitCost from anything but the stored row (STORY-012 AC-2)", async () => {
      // Even if the referenced product's price is different, the mapped
      // response only ever reads PurchaseOrderLine.unitCost — there is no
      // code path here that joins to or reads Product.currentPrice.
      const result = await makeService().findById(1, 1);
      expect(result.lines[0].unitCost).toBe(8.5);
      expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('scopes the query to the tenant', async () => {
      await makeService().findAll(1, { page: 1, per_page: 25 });

      expect(mockPrisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 1 } }),
      );
    });

    it('adds a status filter when provided', async () => {
      await makeService().findAll(1, { page: 1, per_page: 25 }, 'received');

      expect(mockPrisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 1, status: 'received' },
        }),
      );
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        makeService().findAll(999, { page: 1, per_page: 25 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('adds an orderDate range filter when dateFrom/dateTo are provided (STORY-028)', async () => {
      await makeService().findAll(1, {
        page: 1,
        per_page: 25,
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });

      expect(mockPrisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 1,
            orderDate: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-01-31'),
            },
          },
        }),
      );
    });

    it('combines status and date-range filters with AND, not OR (STORY-028)', async () => {
      await makeService().findAll(
        1,
        { page: 1, per_page: 25, dateFrom: '2026-01-01' },
        'received',
      );

      expect(mockPrisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 1,
            status: 'received',
            orderDate: { gte: new Date('2026-01-01') },
          },
        }),
      );
    });
  });
});
