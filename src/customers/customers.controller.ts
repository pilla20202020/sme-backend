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
import { CustomersService } from './customers.service';
import { CustomerResponse, PaginatedResult } from './customers.interface';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Customers')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/customers' })
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('customer:create')
  @AuditAction('customer.create', 'Customer')
  @ApiOperation({ summary: 'Create a customer record under a tenant' })
  @ApiResponse({ status: 201, description: 'Customer created successfully' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: CreateCustomerDto,
  ): Promise<CustomerResponse> {
    return this.customersService.create(tenantId, dto);
  }

  @Get()
  @Permissions('customer:read')
  @ApiOperation({
    summary:
      'List customers for a tenant, paginated, optionally searched by name/phone',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of customer records',
  })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: ListCustomersQueryDto,
  ): Promise<PaginatedResult<CustomerResponse>> {
    return this.customersService.findAll(tenantId, query);
  }
}
