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
import { CategoriesService } from './categories.service';
import { CategoryResponse, PaginatedResult } from './categories.interface';
import { CreateCategoryDto } from './dto/create-category.dto';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Categories')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/categories' })
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('catalog:create')
  @AuditAction('category.create', 'Category')
  @ApiOperation({ summary: 'Create a product category under a tenant' })
  @ApiResponse({ status: 201, description: 'Category created successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  @ApiResponse({
    status: 409,
    description: 'Category name already exists for this tenant',
  })
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryResponse> {
    return this.categoriesService.create(tenantId, dto);
  }

  @Get()
  @Permissions('catalog:read')
  @ApiOperation({ summary: 'List all categories for a tenant, paginated' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of category records',
  })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<CategoryResponse>> {
    return this.categoriesService.findAll(tenantId, query);
  }
}
