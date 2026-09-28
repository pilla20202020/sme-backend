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
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { QuoteSaleDto } from './dto/quote-sale.dto';
import {
  PaginatedResult,
  QuoteResponse,
  SaleReceiptResponse,
} from './sales.interface';
import { SalesService } from './sales.service';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Sales')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/sales' })
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @Permissions('sales:create')
  @ApiOperation({
    summary:
      'Read-only, side-effect-free stock/price dry-run for a would-be sale (STORY-019). Writes nothing — a future cart UI would call this on every add/remove.',
  })
  @ApiResponse({ status: 200, description: 'Quote computed' })
  @ApiResponse({
    status: 404,
    description: 'A productId does not belong to this tenant',
  })
  quote(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: QuoteSaleDto,
  ): Promise<QuoteResponse> {
    return this.salesService.quote(tenantId, dto);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('sales:create')
  @AuditAction('sale.create', 'Sale')
  @ApiOperation({
    summary:
      'Checkout: atomically decrements real stock FEFO (soonest-expiring batch first) and records the sale. All-or-nothing — any line that cannot be fully satisfied rolls back the entire request.',
  })
  @ApiResponse({
    status: 201,
    description: 'Sale created; response is the itemized receipt shape',
  })
  @ApiResponse({
    status: 404,
    description: 'A productId or customerId does not belong to this tenant',
  })
  @ApiResponse({
    status: 409,
    description: 'Insufficient stock for one or more lines; nothing written',
  })
  checkout(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: CreateSaleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SaleReceiptResponse> {
    return this.salesService.checkout(tenantId, dto, user?.userId);
  }

  @Get()
  @Permissions('sales:read')
  @ApiOperation({
    summary:
      'List sales for a tenant, paginated and filterable by dateFrom/dateTo on saleDate (STORY-028). Default sort: saleDate desc.',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of sales' })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: ListSalesQueryDto,
  ): Promise<PaginatedResult<SaleReceiptResponse>> {
    return this.salesService.findAll(tenantId, query);
  }

  @Get(':saleId')
  @Permissions('sales:read')
  @ApiOperation({
    summary:
      'Canonical "get a sale" read — the stable lookup endpoint EPIC-007 (returns) will use, independent of the receipt-flavored response.',
  })
  @ApiResponse({ status: 200, description: 'Sale found' })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  findById(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('saleId', ParseIntPipe) saleId: number,
  ): Promise<SaleReceiptResponse> {
    return this.salesService.getSale(tenantId, saleId);
  }

  @Get(':saleId/receipt')
  @Permissions('sales:read')
  @ApiOperation({
    summary:
      "Itemized receipt for a completed sale — products, quantities, unit prices and total (STORY-022). Same shape as checkout's response and as GET .../:saleId.",
  })
  @ApiResponse({ status: 200, description: 'Receipt' })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  getReceipt(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('saleId', ParseIntPipe) saleId: number,
  ): Promise<SaleReceiptResponse> {
    return this.salesService.getReceipt(tenantId, saleId);
  }
}
