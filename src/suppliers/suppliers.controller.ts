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
import { SuppliersService } from './suppliers.service';
import { PaginatedResult, SupplierResponse } from './suppliers.interface';
import { CreateSupplierDto } from './dto/create-supplier.dto';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Suppliers')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/suppliers' })
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('supplier:create')
  @AuditAction('supplier.create', 'Supplier')
  @ApiOperation({ summary: 'Create a supplier record under a tenant' })
  @ApiResponse({ status: 201, description: 'Supplier created successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: CreateSupplierDto,
  ): Promise<SupplierResponse> {
    return this.suppliersService.create(tenantId, dto);
  }

  @Get(':supplierId')
  @Permissions('supplier:read')
  @ApiOperation({ summary: 'Get a supplier by ID within a tenant' })
  @ApiResponse({ status: 200, description: 'Supplier record' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  findById(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('supplierId', ParseIntPipe) supplierId: number,
  ): Promise<SupplierResponse> {
    return this.suppliersService.findById(tenantId, supplierId);
  }

  @Get()
  @Permissions('supplier:read')
  @ApiOperation({ summary: 'List all suppliers for a tenant, paginated' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of supplier records',
  })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<SupplierResponse>> {
    return this.suppliersService.findAll(tenantId, query);
  }
}
