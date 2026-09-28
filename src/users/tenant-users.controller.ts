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
import { InviteUserDto } from './dto/invite-user.dto';
import { InvitedUser, SafeUser } from './users.interface';
import { UsersService } from './users.service';

// Tenant scoping is enforced globally by TenantScopeGuard (APP_GUARD, see
// app.module.ts) — not opt-in here (STORY-004 / PRD NF-05).
@ApiTags('Tenant Users')
@ApiCookieAuth('uw_access_token')
@Controller({ version: '1', path: 'tenants/:tenantId/users' })
export class TenantUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('user:create')
  @AuditAction('user.invite', 'User')
  @ApiOperation({
    summary: 'Invite a staff member into a tenant with a specific role',
  })
  @ApiResponse({ status: 201, description: 'User invited successfully' })
  @ApiResponse({ status: 404, description: 'Tenant or role not found' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  invite(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() inviteUserDto: InviteUserDto,
  ): Promise<InvitedUser> {
    return this.usersService.inviteToTenant(tenantId, inviteUserDto);
  }

  @Get()
  @Permissions('user:read')
  @ApiOperation({ summary: 'List all staff for a tenant, paginated' })
  @ApiResponse({ status: 200, description: 'Paginated list of tenant staff' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  findAll(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: PaginationQueryDto,
  ): Promise<{
    data: SafeUser[];
    meta: {
      total: number;
      page: number;
      per_page: number;
      total_pages: number;
    };
  }> {
    return this.usersService.findAllByTenant(tenantId, query);
  }
}
