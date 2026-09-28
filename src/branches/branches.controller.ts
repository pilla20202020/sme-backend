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
import { BranchesService } from './branches.service';
import { BranchResponse } from './branches.interface';
import { CreateBranchDto } from './dto/create-branch.dto';

// Tenant scoping (a caller may only act on their own tenant) is enforced
// globally by TenantScopeGuard (APP_GUARD, see app.module.ts) — every route
// with a :tenantId path param is automatically covered, not opt-in per
// controller (STORY-004 / PRD NF-05).
@ApiTags('Branches')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/branches' })
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('branch:create')
  @AuditAction('branch.create', 'Branch')
  @ApiOperation({ summary: 'Create a branch under a tenant' })
  @ApiResponse({ status: 201, description: 'Branch created successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() createBranchDto: CreateBranchDto,
  ): Promise<BranchResponse> {
    return this.branchesService.create(tenantId, createBranchDto);
  }

  @Get(':branchId')
  @Permissions('branch:read')
  @ApiOperation({ summary: 'Get a branch by ID within a tenant' })
  @ApiResponse({ status: 200, description: 'Branch record' })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  findById(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('branchId', ParseIntPipe) branchId: number,
  ): Promise<BranchResponse> {
    return this.branchesService.findById(tenantId, branchId);
  }

  @Get()
  @Permissions('branch:read')
  @ApiOperation({ summary: 'List all branches for a tenant, paginated' })
  @ApiResponse({ status: 200, description: 'Paginated list of branch records' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: PaginationQueryDto,
  ) {
    return this.branchesService.findAll(tenantId, query);
  }
}
