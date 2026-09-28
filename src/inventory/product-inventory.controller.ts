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
import { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import { ListInventoryMovementsQueryDto } from './dto/list-inventory-movements-query.dto';
import {
  InventoryAdjustmentResponse,
  InventoryMovementResponse,
  OnHandResponse,
  PaginatedResult,
} from './inventory-movements.interface';
import { InventoryMovementsService } from './inventory-movements.service';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Inventory')
@ApiCookieAuth('uw_access_token')
@Controller({
  version: '1',
  path: 'tenants/:tenantId/products/:productId/inventory',
})
export class ProductInventoryController {
  constructor(private readonly movementsService: InventoryMovementsService) {}

  @Get('movements')
  @Permissions('inventory:read')
  @ApiOperation({
    summary:
      "A product's movement history — the 'explain the current count' investigation flow. Same filters as the tenant-level list.",
  })
  @ApiResponse({ status: 200, description: 'Paginated list of movements' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  findAllForProduct(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: ListInventoryMovementsQueryDto,
  ): Promise<PaginatedResult<InventoryMovementResponse>> {
    return this.movementsService.findAllForProduct(tenantId, productId, query);
  }

  @Get('on-hand')
  @Permissions('inventory:read')
  @ApiOperation({
    summary:
      "Canonical 'what do we have right now' read — sum(quantityRemaining) across this product's batches, with a batch-level breakdown.",
  })
  @ApiResponse({ status: 200, description: 'On-hand quantity summary' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  getOnHand(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<OnHandResponse> {
    return this.movementsService.getOnHand(tenantId, productId);
  }

  @Post('adjustments')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('inventory:adjust')
  @AuditAction('inventory.adjust', 'InventoryMovement')
  @ApiOperation({
    summary:
      'Manual stock correction against one batch. reason is required (non-empty after trim). Rejected with 409 if it would drive quantityRemaining below zero.',
  })
  @ApiResponse({
    status: 201,
    description:
      "Adjustment recorded; response includes the new movement and the batch's new quantityRemaining",
  })
  @ApiResponse({ status: 400, description: 'reason is empty/whitespace-only' })
  @ApiResponse({ status: 404, description: 'Product or batch not found' })
  @ApiResponse({
    status: 409,
    description: 'Adjustment would take quantityRemaining below zero',
  })
  createAdjustment(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: CreateInventoryAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InventoryAdjustmentResponse> {
    return this.movementsService.createAdjustment(
      tenantId,
      productId,
      dto,
      user?.userId,
    );
  }
}
