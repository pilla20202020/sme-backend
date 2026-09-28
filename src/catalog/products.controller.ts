import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
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
import { PaginatedResult } from './categories.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdatePriceDto } from './dto/update-price.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  ProductPriceHistoryResponse,
  ProductResponse,
} from './products.interface';
import { ProductsService } from './products.service';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Products')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/products' })
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('catalog:create')
  @AuditAction('product.create', 'Product')
  @ApiOperation({ summary: 'Create a product under a tenant' })
  @ApiResponse({ status: 201, description: 'Product created successfully' })
  @ApiResponse({ status: 404, description: 'Tenant or category not found' })
  @ApiResponse({
    status: 409,
    description: 'sku already used by another product in this tenant',
  })
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: CreateProductDto,
  ): Promise<ProductResponse> {
    return this.productsService.create(tenantId, dto);
  }

  @Get(':productId')
  @Permissions('catalog:read')
  @ApiOperation({ summary: 'Get a product by ID within a tenant' })
  @ApiResponse({ status: 200, description: 'Product record' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  findById(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<ProductResponse> {
    return this.productsService.findById(tenantId, productId);
  }

  @Get()
  @Permissions('catalog:read')
  @ApiOperation({
    summary:
      'List all products for a tenant, paginated, optionally filtered by categoryId and/or search (name/sku)',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of product records',
  })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: ListProductsQueryDto,
  ): Promise<PaginatedResult<ProductResponse>> {
    return this.productsService.findAll(
      tenantId,
      query,
      query.categoryId,
      query.search,
    );
  }

  @Patch(':productId')
  @Permissions('catalog:update')
  @AuditAction('product.update', 'Product')
  @ApiOperation({
    summary:
      'Update a product (name/sku/unit/categoryId/reorderThreshold/isActive). currentPrice is rejected — use PUT .../price.',
  })
  @ApiResponse({ status: 200, description: 'Product updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 404, description: 'Product or category not found' })
  update(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    return this.productsService.update(tenantId, productId, dto);
  }

  @Put(':productId/price')
  @Permissions('catalog:update')
  @AuditAction('product.price_update', 'Product')
  @ApiOperation({
    summary:
      "Update a product's current price, appending a ProductPriceHistory row in the same transaction",
  })
  @ApiResponse({ status: 200, description: 'Price updated successfully' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  updatePrice(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdatePriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductResponse> {
    return this.productsService.updatePrice(
      tenantId,
      productId,
      dto,
      user?.userId,
    );
  }

  @Get(':productId/price-history')
  @Permissions('catalog:read')
  @ApiOperation({
    summary: "List a product's price history, paginated, most-recent-first",
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of price history records',
  })
  @ApiResponse({ status: 404, description: 'Product not found' })
  getPriceHistory(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<ProductPriceHistoryResponse>> {
    return this.productsService.getPriceHistory(tenantId, productId, query);
  }
}
