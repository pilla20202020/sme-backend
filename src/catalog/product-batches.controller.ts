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
import { Permissions } from '../auth/decorators';
import { AuditAction } from '../audit/audit-action.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResult } from './categories.interface';
import { CreateBatchDto } from './dto/create-batch.dto';
import { ProductBatchResponse } from './product-batches.interface';
import { ProductBatchesService } from './product-batches.service';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Product Batches')
@ApiCookieAuth('uw_access_token')
@Controller({
  version: '1',
  path: 'tenants/:tenantId/products/:productId/batches',
})
export class ProductBatchesController {
  constructor(private readonly productBatchesService: ProductBatchesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('catalog:create')
  @AuditAction('batch.create', 'ProductBatch')
  @ApiOperation({
    summary:
      'Receive a batch/lot of a product with expiry date. quantityRemaining starts equal to quantityReceived.',
  })
  @ApiResponse({ status: 201, description: 'Batch created successfully' })
  @ApiResponse({ status: 400, description: 'expiryDate is in the past' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: CreateBatchDto,
  ): Promise<ProductBatchResponse> {
    return this.productBatchesService.create(tenantId, productId, dto);
  }

  @Get()
  @Permissions('catalog:read')
  @ApiOperation({
    summary:
      "List a product's batches, paginated, ordered soonest-expiry-first",
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of batch records',
  })
  @ApiResponse({ status: 404, description: 'Product not found' })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<ProductBatchResponse>> {
    return this.productBatchesService.findAllForProduct(
      tenantId,
      productId,
      query,
    );
  }
}
