import { NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';

const RAW_CUSTOMER = {
  customerId: 1,
  tenantId: 1,
  name: 'Jane Doe',
  phone: '555-0101',
  email: 'jane@example.com',
  address: '123 Main St',
  isActive: true,
  createdAt: new Date(2026, 0, 1, 9, 0),
  updatedAt: new Date(2026, 0, 2, 9, 0),
};

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
  customer: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const makeService = () => new CustomersService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();

  mockPrisma.tenant.findUnique.mockResolvedValue({ tenantId: 1 });
  mockPrisma.customer.create.mockResolvedValue(RAW_CUSTOMER);
  mockPrisma.customer.findMany.mockResolvedValue([RAW_CUSTOMER]);
  mockPrisma.customer.count.mockResolvedValue(1);
});

describe('CustomersService', () => {
  it('should be defined', () => {
    expect(makeService()).toBeDefined();
  });

  describe('create', () => {
    it('creates a customer scoped to the given tenant', async () => {
      const result = await makeService().create(1, {
        name: 'Jane Doe',
        phone: '555-0101',
        email: 'jane@example.com',
        address: '123 Main St',
      });

      expect(mockPrisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 1,
            name: 'Jane Doe',
            phone: '555-0101',
            email: 'jane@example.com',
            address: '123 Main St',
          }) as never,
        }),
      );
      expect(result.tenantId).toBe(1);
      expect(result.name).toBe('Jane Doe');
    });

    it('allows creating a customer with only a name (no phone/email/address)', async () => {
      mockPrisma.customer.create.mockResolvedValue({
        ...RAW_CUSTOMER,
        phone: null,
        email: null,
        address: null,
      });

      const result = await makeService().create(1, { name: 'John Roe' });

      expect(result.phone).toBeNull();
      expect(result.email).toBeNull();
      expect(result.address).toBeNull();
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        makeService().create(999, { name: 'Ghost Customer' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.customer.create).not.toHaveBeenCalled();
    });

    it('does not enforce any uniqueness on phone/email/name (duplicates allowed)', async () => {
      // No P2002/ConflictException handling exists in create() at all — a
      // duplicate customer is simply created again, per the PRD.
      await makeService().create(1, { name: 'Jane Doe', phone: '555-0101' });
      await makeService().create(1, { name: 'Jane Doe', phone: '555-0101' });

      expect(mockPrisma.customer.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('findAll', () => {
    it('returns mapped data scoped to the tenant with pagination meta when no search given', async () => {
      const result = await makeService().findAll(1, { page: 1, per_page: 25 });

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
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

    it('filters by name OR phone (case-insensitive contains) when search is given', async () => {
      await makeService().findAll(1, {
        page: 1,
        per_page: 25,
        search: 'jane',
      });

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 1,
            OR: [
              { name: { contains: 'jane', mode: 'insensitive' } },
              { phone: { contains: 'jane', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('returns an empty list (not an error) when no customer matches the search', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      const result = await makeService().findAll(1, {
        page: 1,
        per_page: 25,
        search: 'nobody',
      });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(makeService().findAll(999, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('computes skip from page and per_page', async () => {
      await makeService().findAll(1, { page: 3, per_page: 10 });

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });
});
