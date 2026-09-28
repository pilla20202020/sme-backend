import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DailyCashResponse } from './cash.interface';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tenant-wide (not per-branch — see PRD §2/§7) net cash position for one
   * UTC calendar day, computed on demand from Sale/Return/Expense — same
   * "no persistent rollup table" pattern as Sprint 4's low-stock/near-expiry
   * alerts. No timezone infrastructure exists anywhere in this codebase
   * yet, so "day" means UTC day, same simplification made everywhere else
   * dates are compared (see formatDateMDY's date-only branch).
   */
  async getDaily(tenantId: number, date: string): Promise<DailyCashResponse> {
    const dayStart = this.parseCalendarDate(date);
    const dayNext = new Date(dayStart);
    dayNext.setUTCDate(dayNext.getUTCDate() + 1);

    const [salesAgg, returnsAgg, expensesAgg] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { tenantId, saleDate: { gte: dayStart, lt: dayNext } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.return.aggregate({
        where: { tenantId, returnDate: { gte: dayStart, lt: dayNext } },
        _sum: { refundTotal: true },
        _count: true,
      }),
      this.prisma.expense.aggregate({
        where: { tenantId, expenseDate: { gte: dayStart, lt: dayNext } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const salesTotal = round2(salesAgg._sum.total?.toNumber() ?? 0);
    const returnsTotal = round2(returnsAgg._sum.refundTotal?.toNumber() ?? 0);
    const expensesTotal = round2(expensesAgg._sum.amount?.toNumber() ?? 0);
    const netCashPosition = round2(salesTotal - returnsTotal - expensesTotal);

    return {
      date,
      salesTotal,
      returnsTotal,
      expensesTotal,
      netCashPosition,
      saleCount: salesAgg._count,
      returnCount: returnsAgg._count,
      expenseCount: expensesAgg._count,
    };
  }

  /**
   * Strict YYYY-MM-DD + real-calendar-date check (PRD §7: "must parse as a
   * valid calendar date — 400 otherwise"). `new Date("2024-02-30")`-style
   * inputs don't throw in JS — they silently roll over into March — so the
   * regex alone isn't enough; round-tripping through toISOString() and
   * comparing catches that rollover too.
   */
  private parseCalendarDate(date: string): Date {
    if (!DATE_ONLY_PATTERN.test(date)) {
      throw new BadRequestException(
        'date must be a valid calendar date in YYYY-MM-DD format',
      );
    }
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      throw new BadRequestException(
        'date must be a valid calendar date in YYYY-MM-DD format',
      );
    }
    return parsed;
  }
}
