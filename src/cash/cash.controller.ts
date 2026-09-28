import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../auth/decorators';
import { DailyCashResponse } from './cash.interface';
import { CashService } from './cash.service';
import { DailyCashQueryDto } from './dto/daily-cash-query.dto';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Cash')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/cash' })
export class CashController {
  constructor(private readonly cashService: CashService) {}

  @Get('daily')
  @Permissions('cash:read')
  @ApiOperation({
    summary:
      'Daily net-cash reconciliation for a tenant, computed on demand from Sale/Return/Expense (STORY-026). No branch breakdown or payment-method split this sprint.',
  })
  @ApiResponse({ status: 200, description: 'Daily cash reconciliation' })
  @ApiResponse({
    status: 400,
    description: 'date is missing or is not a valid calendar date',
  })
  getDaily(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: DailyCashQueryDto,
  ): Promise<DailyCashResponse> {
    return this.cashService.getDaily(tenantId, query.date);
  }
}
