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
import { Permissions, Roles } from '../auth/decorators';
import { Public } from '../auth/public.decorator';
import { AuditAction } from '../audit/audit-action.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantResponse } from './tenants.interface';
import { TenantsService } from './tenants.service';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Tenants')
@Controller({ version: '1', path: 'tenants' })
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @AuditAction('tenant.create', 'Tenant')
  @ApiOperation({ summary: 'Register a new business as an isolated tenant' })
  @ApiResponse({ status: 201, description: 'Tenant created successfully' })
  register(@Body() createTenantDto: CreateTenantDto): Promise<TenantResponse> {
    return this.tenantsService.register(createTenantDto);
  }

  @Get(':tenantId')
  @ApiCookieAuth('uw_access_token')
  @Permissions('tenant:read')
  @ApiOperation({
    summary:
      'Get a tenant by ID (any role holding tenant:read for their own tenant, e.g. owner — or admin for any tenant)',
  })
  @ApiResponse({ status: 200, description: 'Tenant record' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  findById(
    @Param('tenantId', ParseIntPipe) tenantId: number,
  ): Promise<TenantResponse> {
    return this.tenantsService.findById(tenantId);
  }

  @Get()
  @ApiCookieAuth('uw_access_token')
  @Roles('admin')
  @Permissions('tenant:read')
  @ApiOperation({
    summary:
      'List every tenant on the platform (admin only — this is a cross-tenant, unscoped listing, not per-tenant self-service)',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of tenant records' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.tenantsService.findAll(query);
  }
}
