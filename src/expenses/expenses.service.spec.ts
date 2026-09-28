import { NotFoundException } from '@nestjs/common';
import { ExpensesService } from './expenses.service';

const decimal = (n: number) => ({ toNumber: () => n });

const mockPrisma = {
  branch: { findFirst: jest.fn() },
  expense: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const makeService = () => new ExpensesService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ExpensesService', () => {
  describe('create (STORY-025)', () => {
    it('throws NotFoundException when branchId does not belong to the tenant', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue(null);

      await expect(
        makeService().create(1, {
          branchId: 999,
          category: 'Utilities',
          amount: 100,
          expenseDate: '2026-01-01',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.expense.create).not.toHaveBeenCalled();
    });

    it('creates the expense with branch attribution and the resolved recordedBy', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ branchId: 1 });
      mockPrisma.expense.create.mockResolvedValue({
        expenseId: 1,
        tenantId: 1,
        branchId: 1,
        category: 'Utilities',
        amount: decimal(100),
        description: null,
        expenseDate: new Date('2026-01-01'),
        recordedBy: 7,
        createdAt: new Date(2026, 0, 1),
      });

      const result = await makeService().create(
        1,
        {
          branchId: 1,
          category: 'Utilities',
          amount: 100,
          expenseDate: '2026-01-01',
        },
        7,
      );

      expect(mockPrisma.expense.create).toHaveBeenCalledWith({
        data: {
          tenantId: 1,
          branchId: 1,
          category: 'Utilities',
          amount: 100,
          description: null,
          expenseDate: new Date('2026-01-01'),
          recordedBy: 7,
        },
      });
      expect(result.amount).toBe(100);
      expect(result.branchId).toBe(1);
    });
  });

  describe('findAll (STORY-025)', () => {
    it('filters by branchId/category/dateFrom/dateTo and paginates', async () => {
      mockPrisma.expense.findMany.mockResolvedValue([]);
      mockPrisma.expense.count.mockResolvedValue(0);

      await makeService().findAll(1, {
        page: 2,
        per_page: 10,
        branchId: 1,
        category: 'Utilities',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });

      expect(mockPrisma.expense.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 1,
          branchId: 1,
          category: 'Utilities',
          expenseDate: {
            gte: new Date('2026-01-01'),
            lte: new Date('2026-01-31'),
          },
        },
        skip: 10,
        take: 10,
        orderBy: { expenseDate: 'desc' },
      });
    });
  });
});
