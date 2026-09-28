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
import { CurrentUser, Permissions } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { AuditAction } from '../audit/audit-action.decorator';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ListPurchaseOrdersQueryDto } from './dto/list-purchase-orders-query.dto';
import {
  PaginatedResult,
  PurchaseOrderResponse,
} from './purchase-orders.interface';
import { PurchaseOrdersService } from './purchase-orders.service';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Purchase Orders')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/purchase-orders' })
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('purchasing:create')
  @AuditAction('purchase_order.create', 'PurchaseOrder')
  @ApiOperation({ summary: 'Create a purchase order against a supplier' })
  @ApiResponse({
    status: 201,
    description: 'Purchase order created, in pending status',
  })
  @ApiResponse({ status: 400, description: 'lines must not be empty' })
  @ApiResponse({
    status: 404,
    description: 'Tenant, supplier, or a referenced product not found',
  })
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrdersService.create(tenantId, dto, user?.userId);
  }

  @Get(':purchaseOrderId')
  @Permissions('purchasing:read')
  @ApiOperation({
    summary:
      'Get a purchase order by ID, including lines, status, and per-line quantityOrdered/quantityReceived',
  })
  @ApiResponse({ status: 200, description: 'Purchase order record' })
  @ApiResponse({ status: 404, description: 'Purchase order not found' })
  findById(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('purchaseOrderId', ParseIntPipe) purchaseOrderId: number,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrdersService.findById(tenantId, purchaseOrderId);
  }

  @Get()
  @Permissions('purchasing:read')
  @ApiOperation({
    summary:
      'List all purchase orders for a tenant, paginated, optionally filtered by status',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of purchase order records',
  })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: ListPurchaseOrdersQueryDto,
  ): Promise<PaginatedResult<PurchaseOrderResponse>> {
    return this.purchaseOrdersService.findAll(tenantId, query, query.status);
  }
}
