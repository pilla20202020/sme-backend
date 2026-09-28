import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { ExpenseResponse, PaginatedResult } from './expenses.interface';

type RawExpense = Prisma.ExpenseGetPayload<Record<string, never>>;

function mapExpense(expense: RawExpense): ExpenseResponse {
  return {
    expenseId: expense.expenseId,
    tenantId: expense.tenantId,
    branchId: expense.branchId,
    category: expense.category,
    amount: expense.amount.toNumber(),
    description: expense.description,
    expenseDate: formatDateMDY(expense.expenseDate),
    recordedBy: expense.recordedBy,
    createdAt: formatDateMDY(expense.createdAt, { includeTime: true }),
  };
}

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertBranchBelongsToTenant(
    tenantId: number,
    branchId: number,
  ): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { branchId, tenantId },
      select: { branchId: true },
    });
    if (!branch) {
      throw new NotFoundException(
        `Branch ${branchId} not found for tenant ${tenantId}`,
      );
    }
  }

  /**
   * Expense is the first model in this project to actually carry a
   * branchId (PRD §2/§6) — Sale/Return remain tenant-level.
   */
  async create(
    tenantId: number,
    dto: CreateExpenseDto,
    recordedBy?: number,
  ): Promise<ExpenseResponse> {
    await this.assertBranchBelongsToTenant(tenantId, dto.branchId);

    const expense = await this.prisma.expense.create({
      data: {
        tenantId,
        branchId: dto.branchId,
        category: dto.category,
        amount: dto.amount,
        description: dto.description ?? null,
        expenseDate: new Date(dto.expenseDate),
        recordedBy: recordedBy ?? null,
      },
    });

    return mapExpense(expense);
  }

  async findAll(
    tenantId: number,
    query: ListExpensesQueryDto,
  ): Promise<PaginatedResult<ExpenseResponse>> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const where: Prisma.ExpenseWhereInput = {
      tenantId,
      ...(query.branchId != null && { branchId: query.branchId }),
      ...(query.category != null && { category: query.category }),
      ...((query.dateFrom || query.dateTo) && {
        expenseDate: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo) }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { expenseDate: 'desc' },
      }),
      this.prisma.expense.count({ where }),
    ]);

    return {
      data: data.map(mapExpense),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
