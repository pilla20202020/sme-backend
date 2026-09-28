import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../auth/decorators';
import { NearExpiryQueryDto } from './dto/near-expiry-query.dto';
import { ListInventoryMovementsQueryDto } from './dto/list-inventory-movements-query.dto';
import {
  LowStockAlertEntry,
  NearExpiryAlertEntry,
} from './inventory-alerts.interface';
import { InventoryAlertsService } from './inventory-alerts.service';
import {
  InventoryMovementResponse,
  PaginatedResult,
} from './inventory-movements.interface';
import { InventoryMovementsService } from './inventory-movements.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Inventory')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/inventory' })
export class InventoryController {
  constructor(
    private readonly movementsService: InventoryMovementsService,
    private readonly alertsService: InventoryAlertsService,
  ) {}

  @Get('movements')
  @Permissions('inventory:read')
  @ApiOperation({
    summary:
      'List inventory movements for a tenant, paginated and filterable by productId/movementType/dateFrom/dateTo. Default sort: occurredAt desc.',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of movements' })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: ListInventoryMovementsQueryDto,
  ): Promise<PaginatedResult<InventoryMovementResponse>> {
    return this.movementsService.findAll(tenantId, query);
  }

  @Get('alerts/low-stock')
  @Permissions('inventory:read')
  @ApiOperation({
    summary:
      'Products where sum(quantityRemaining) is strictly less than reorderThreshold. Products with a null reorderThreshold never appear. Sorted worst-shortage-first.',
  })
  @ApiResponse({ status: 200, description: 'Paginated low-stock alert list' })
  getLowStock(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<LowStockAlertEntry>> {
    return this.alertsService.getLowStock(tenantId, query);
  }

  @Get('alerts/near-expiry')
  @Permissions('inventory:read')
  @ApiOperation({
    summary:
      'Batches with quantityRemaining > 0 expiring within `withinDays` (default 30, must be a positive integer). Already-expired batches still appear. Sorted expiryDate ascending.',
  })
  @ApiResponse({ status: 200, description: 'Paginated near-expiry alert list' })
  @ApiResponse({
    status: 400,
    description: 'withinDays is not a positive integer',
  })
  getNearExpiry(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: NearExpiryQueryDto,
  ): Promise<PaginatedResult<NearExpiryAlertEntry>> {
    return this.alertsService.getNearExpiry(
      tenantId,
      query.withinDays ?? 30,
      query,
    );
  }
}
