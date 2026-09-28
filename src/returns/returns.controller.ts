import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuditAction } from '../audit/audit-action.decorator';
import { CurrentUser, Permissions } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { CreateReturnDto } from './dto/create-return.dto';
import { ReturnResponse } from './returns.interface';
import { ReturnsService } from './returns.service';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Returns')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/returns' })
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('returns:create')
  @AuditAction('return.create', 'Return')
  @ApiOperation({
    summary:
      'Process a return. With saleId: reverses the named SaleLineBatchAllocation(s) against the original sale. Without saleId: a manager-override unmatched return, requiring overrideApprovedBy to name a user with returns:override.',
  })
  @ApiResponse({
    status: 201,
    description: 'Return created; response includes its lines',
  })
  @ApiResponse({
    status: 400,
    description:
      'reason is empty, lines is empty, or neither saleId nor overrideApprovedBy was supplied',
  })
  @ApiResponse({
    status: 403,
    description:
      'overrideApprovedBy does not name a user with returns:override',
  })
  @ApiResponse({
    status: 404,
    description:
      'The sale, a saleLineBatchAllocationId, or a productId/productBatchId does not belong to this tenant',
  })
  @ApiResponse({
    status: 409,
    description:
      'Return quantity would exceed an allocation’s remaining returnable amount',
  })
  create(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: CreateReturnDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReturnResponse> {
    return this.returnsService.create(tenantId, dto, user?.userId);
  }

  @Get(':returnId')
  @Permissions('returns:read')
  @ApiOperation({ summary: 'Get a return by ID, including its lines' })
  @ApiResponse({ status: 200, description: 'Return found' })
  @ApiResponse({ status: 404, description: 'Return not found' })
  findById(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('returnId', ParseIntPipe) returnId: number,
  ): Promise<ReturnResponse> {
    return this.returnsService.getReturn(tenantId, returnId);
  }
}
