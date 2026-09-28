import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions, Roles } from '../auth/decorators';
import { AuditLogService } from './audit-log.service';
import { AuditLogResponse, PaginatedResult } from './audit-logs.interface';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05). Note that
// TenantScopeGuard bypasses its own check entirely for the `admin` role
// (see tenant-scope.guard.ts), which is exactly what this endpoint needs:
// @Roles('admin') below is what actually restricts this to admin/support —
// deliberately excluding even a tenant's own `owner`, per PRD FR-25 AC-2 /
// STORY-037 AC-2. This is the one deliberate exception in this codebase to
// the usual "owners manage their own tenant's data" pattern.
@ApiTags('Audit Logs')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/audit-logs' })
export class AuditLogsController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @Roles('admin')
  @Permissions('audit:read')
  @ApiOperation({
    summary:
      "Query the audit log for a tenant, paginated, with optional combinable actorUserId/action/from/to filters. Admin/support only — even the tenant's own owner is denied.",
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of audit log records',
  })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<PaginatedResult<AuditLogResponse>> {
    return this.auditLogService.findAll(tenantId, query);
  }
}
