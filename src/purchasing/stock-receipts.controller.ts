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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateStockReceiptDto } from './dto/create-stock-receipt.dto';
import {
  PaginatedResult,
  StockReceiptCreateResponse,
  StockReceiptResponse,
} from './stock-receipts.interface';
import { StockReceiptsService } from './stock-receipts.service';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Stock Receiving')
@ApiCookieAuth('uw_access_token')
@Controller({
  version: '1',
  path: 'tenants/:tenantId/purchase-orders/:purchaseOrderId/receipts',
})
export class StockReceiptsController {
  constructor(private readonly stockReceiptsService: StockReceiptsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('purchasing:update')
  @AuditAction('stock.receive', 'StockReceipt')
  @ApiOperation({
    summary:
      'Record what was actually received against a purchase order. Always succeeds; a mismatch against the outstanding ordered quantity is reported in `discrepancies`, never silently reconciled.',
  })
  @ApiResponse({
    status: 201,
    description:
      "Receipt created; response includes the created lines, any discrepancies, and the PO's recomputed status",
  })
  @ApiResponse({ status: 400, description: 'expiryDate is in the past' })
  @ApiResponse({
    status: 404,
    description:
      'Purchase order not found, or a referenced purchaseOrderLineId does not belong to it',
  })
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('purchaseOrderId', ParseIntPipe) purchaseOrderId: number,
    @Body() dto: CreateStockReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StockReceiptCreateResponse> {
    return this.stockReceiptsService.createReceipt(
      tenantId,
      purchaseOrderId,
      dto,
      user?.userId,
    );
  }

  @Get()
  @Permissions('purchasing:read')
  @ApiOperation({
    summary: 'List all receipt events against a purchase order, paginated',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of stock receipt records',
  })
  @ApiResponse({ status: 404, description: 'Purchase order not found' })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('purchaseOrderId', ParseIntPipe) purchaseOrderId: number,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<StockReceiptResponse>> {
    return this.stockReceiptsService.findAllForPurchaseOrder(
      tenantId,
      purchaseOrderId,
      query,
    );
  }
}
