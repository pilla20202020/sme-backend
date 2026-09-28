import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuditAction } from '../audit/audit-action.decorator';
import { CurrentUser, Permissions } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { ExpenseResponse, PaginatedResult } from './expenses.interface';
import { ExpensesService } from './expenses.service';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Expenses')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/expenses' })
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('expense:create')
  @AuditAction('expense.create', 'Expense')
  @ApiOperation({
    summary:
      'Record an expense with category and branch attribution (STORY-025).',
  })
  @ApiResponse({ status: 201, description: 'Expense created' })
  @ApiResponse({ status: 400, description: 'amount is not a positive decimal' })
  @ApiResponse({
    status: 404,
    description: 'branchId does not belong to this tenant',
  })
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExpenseResponse> {
    return this.expensesService.create(tenantId, dto, user?.userId);
  }

  @Get()
  @Permissions('expense:read')
  @ApiOperation({
    summary:
      'List expenses for a tenant, paginated and filterable by branchId/category/dateFrom/dateTo.',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of expenses' })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: ListExpensesQueryDto,
  ): Promise<PaginatedResult<ExpenseResponse>> {
    return this.expensesService.findAll(tenantId, query);
  }
}
