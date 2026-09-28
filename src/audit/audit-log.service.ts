import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { AuditLogResponse, PaginatedResult } from './audit-logs.interface';

/** Denormalized label used whenever a mutating `@AuditAction`-decorated
 * route is reached with no `request.user` — i.e. a `@Public()` endpoint
 * such as tenant registration (PRD Part B). */
export const ANONYMOUS_ACTOR_LABEL = 'Anonymous (public endpoint)';

export interface AuditActorLike {
  firstName?: string | null;
  lastName?: string | null;
  roles?: string[];
}

export interface RecordAuditParams {
  tenantId: number;
  actorUserId: number | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
}

function mapAuditLog(row: {
  id: bigint;
  tenantId: number;
  actorUserId: number | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}): AuditLogResponse {
  return {
    id: row.id.toString(),
    tenantId: row.tenantId,
    actorUserId: row.actorUserId,
    actorLabel: row.actorLabel,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata,
    createdAt: formatDateMDY(row.createdAt, { includeTime: true }),
  };
}

/**
 * Owns AuditLog row creation and querying (STORY-036/037). Kept separate
 * from `AuditInterceptor` so both the write path and the `targetId`
 * extraction heuristic can be unit-tested directly, without going through a
 * full HTTP request.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the denormalized `actorLabel` from a resolved request user, or
   * the fixed anonymous label when no user is present (a `@Public()`
   * mutating endpoint, e.g. tenant registration).
   */
  buildActorLabel(user?: AuditActorLike | null): string {
    if (!user) {
      return ANONYMOUS_ACTOR_LABEL;
    }
    const roles = Array.isArray(user.roles) ? user.roles.join(',') : '';
    return `${user.firstName ?? ''} ${user.lastName ?? ''} (${roles})`;
  }

  /**
   * Finds the first property of a response's `data` object whose key ends
   * in "Id" (e.g. `tenantId`, `branchId`, `productId`) and stringifies its
   * value. Returns null for anything that isn't a plain object (arrays,
   * primitives, null/undefined) or that has no such key — a documented,
   * acceptable limitation (e.g. a bulk-import summary with no single ID),
   * not a bug to chase.
   */
  extractTargetId(data: unknown): string | null {
    if (data == null || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }

    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (
        key.endsWith('Id') &&
        (typeof value === 'number' ||
          typeof value === 'string' ||
          typeof value === 'bigint')
      ) {
        return String(value);
      }
    }

    return null;
  }

  /** Writes one append-only AuditLog row. Never throws — a failure to write
   * an audit record must never turn an otherwise-successful business
   * mutation into an error response; failures are logged instead. */
  async record(params: RecordAuditParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: params.tenantId,
          actorUserId: params.actorUserId,
          actorLabel: params.actorLabel,
          action: params.action,
          targetType: params.targetType,
          targetId: params.targetId,
          metadata:
            params.metadata === undefined || params.metadata === null
              ? Prisma.JsonNull
              : (params.metadata as Prisma.InputJsonValue),
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for action "${params.action}" (tenant ${params.tenantId})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** STORY-037 — admin-only, filterable audit query. */
  async findAll(
    tenantId: number,
    query: ListAuditLogsQueryDto,
  ): Promise<PaginatedResult<AuditLogResponse>> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const createdAtFilter: Prisma.DateTimeFilter = {};
    if (query.from) createdAtFilter.gte = new Date(query.from);
    if (query.to) createdAtFilter.lte = new Date(query.to);

    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(query.actorUserId != null ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to ? { createdAt: createdAtFilter } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: data.map(mapAuditLog),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
