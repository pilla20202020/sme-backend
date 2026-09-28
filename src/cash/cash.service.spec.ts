import { BadRequestException } from '@nestjs/common';
import { CashService } from './cash.service';

const decimal = (n: number) => ({ toNumber: () => n });

const mockPrisma = {
  sale: { aggregate: jest.fn() },
  return: { aggregate: jest.fn() },
  expense: { aggregate: jest.fn() },
};

const makeService = () => new CashService(mockPrisma as never);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CashService.getDaily (STORY-026)', () => {
  it('rejects a malformed date (not YYYY-MM-DD) with 400', async () => {
    await expect(makeService().getDaily(1, '01/01/2026')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a calendar-invalid date (e.g. Feb 30) with 400 even though JS Date silently rolls it over', async () => {
    await expect(makeService().getDaily(1, '2026-02-30')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('PRD §7 worked example: 500 in sales, 50 returned, 100 expensed -> netCashPosition 350', async () => {
    mockPrisma.sale.aggregate.mockResolvedValue({
      _sum: { total: decimal(500) },
      _count: 2,
    });
    mockPrisma.return.aggregate.mockResolvedValue({
      _sum: { refundTotal: decimal(50) },
      _count: 1,
    });
    mockPrisma.expense.aggregate.mockResolvedValue({
      _sum: { amount: decimal(100) },
      _count: 1,
    });

    const result = await makeService().getDaily(1, '2026-01-01');

    expect(result).toEqual({
      date: '2026-01-01',
      salesTotal: 500,
      returnsTotal: 50,
      expensesTotal: 100,
      netCashPosition: 350,
      saleCount: 2,
      returnCount: 1,
      expenseCount: 1,
    });

    const [saleCall] = mockPrisma.sale.aggregate.mock.calls[0] as [
      { where: { saleDate: { gte: Date; lt: Date } } },
    ];
    expect(saleCall.where.saleDate.gte.toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(saleCall.where.saleDate.lt.toISOString()).toBe(
      '2026-01-02T00:00:00.000Z',
    );
  });

  it('returns all zeros for a day with no activity, never null', async () => {
    mockPrisma.sale.aggregate.mockResolvedValue({
      _sum: { total: null },
      _count: 0,
    });
    mockPrisma.return.aggregate.mockResolvedValue({
      _sum: { refundTotal: null },
      _count: 0,
    });
    mockPrisma.expense.aggregate.mockResolvedValue({
      _sum: { amount: null },
      _count: 0,
    });

    const result = await makeService().getDaily(1, '2026-03-15');

    expect(result).toEqual({
      date: '2026-03-15',
      salesTotal: 0,
      returnsTotal: 0,
      expensesTotal: 0,
      netCashPosition: 0,
      saleCount: 0,
      returnCount: 0,
      expenseCount: 0,
    });
  });
});
