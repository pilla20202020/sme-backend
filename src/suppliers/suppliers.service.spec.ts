import { NotFoundException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';

const RAW_SUPPLIER = {
  supplierId: 1,
  tenantId: 1,
  name: 'Acme Pharma',
  contactPerson: 'John Smith',
  phone: '555-0202',
  email: 'sales@acmepharma.example',
  paymentTerms: 'Net 30',
  address: '789 Industrial Rd',
  isActive: true,
  createdAt: new Date(2026, 0, 1, 9, 0),
  updatedAt: new Date(2026, 0, 2, 9, 0),
};

const OTHER_TENANT_SUPPLIER = {
  ...RAW_SUPPLIER,
  supplierId: 2,
  tenantId: 2,
  name: 'A Different Tenant’s Supplier',
};

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
  supplier: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const makeService = () => new SuppliersService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();

  mockPrisma.tenant.findUnique.mockResolvedValue({ tenantId: 1 });
  mockPrisma.supplier.create.mockResolvedValue(RAW_SUPPLIER);
  mockPrisma.supplier.findFirst.mockResolvedValue(RAW_SUPPLIER);
  mockPrisma.supplier.findMany.mockResolvedValue([RAW_SUPPLIER]);
  mockPrisma.supplier.count.mockResolvedValue(1);
});

describe('SuppliersService', () => {
  it('should be defined', () => {
    expect(makeService()).toBeDefined();
  });

  describe('create', () => {
    it('creates a supplier scoped to the given tenant with full contact details', async () => {
      const result = await makeService().create(1, {
        name: 'Acme Pharma',
        contactPerson: 'John Smith',
        phone: '555-0202',
        email: 'sales@acmepharma.example',
        paymentTerms: 'Net 30',
        address: '789 Industrial Rd',
      });

      expect(mockPrisma.supplier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 1,
            name: 'Acme Pharma',
            contactPerson: 'John Smith',
            phone: '555-0202',
            email: 'sales@acmepharma.example',
            paymentTerms: 'Net 30',
            address: '789 Industrial Rd',
          }) as never,
        }),
      );
      expect(result.tenantId).toBe(1);
      expect(result.name).toBe('Acme Pharma');
      expect(result.paymentTerms).toBe('Net 30');
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        makeService().create(999, { name: 'Ghost Supplier' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.supplier.create).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns the supplier when it belongs to the given tenant', async () => {
      const result = await makeService().findById(1, 1);

      expect(mockPrisma.supplier.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supplierId: 1, tenantId: 1 },
        }),
      );
      expect(result.supplierId).toBe(1);
    });

    it('throws NotFoundException when the supplier belongs to a different tenant', async () => {
      mockPrisma.supplier.findFirst.mockImplementation(
        ({ where }: { where: { supplierId: number; tenantId: number } }) =>
          Promise.resolve(
            [RAW_SUPPLIER, OTHER_TENANT_SUPPLIER].find(
              (s) =>
                s.supplierId === where.supplierId &&
                s.tenantId === where.tenantId,
            ) ?? null,
          ),
      );

      await expect(makeService().findById(1, 2)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for a supplier ID that does not exist at all', async () => {
      mockPrisma.supplier.findFirst.mockResolvedValue(null);

      await expect(makeService().findById(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('returns mapped data scoped to the tenant with pagination meta', async () => {
      const result = await makeService().findAll(1, { page: 1, per_page: 25 });

      expect(mockPrisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 1 } }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        per_page: 25,
        total_pages: 1,
      });
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(makeService().findAll(999, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('computes skip from page and per_page', async () => {
      await makeService().findAll(1, { page: 3, per_page: 10 });

      expect(mockPrisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });
});
