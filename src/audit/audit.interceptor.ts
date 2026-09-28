import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { AuthenticatedUser } from '../auth/jwt-auth.guard';
import {
  AUDIT_ACTION_KEY,
  AuditActionMetadata,
} from './audit-action.decorator';
import { AuditLogService } from './audit-log.service';

type AuditableRequest = Request & {
  method: string;
  params: Record<string, string>;
  user?: AuthenticatedUser;
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Global interceptor (registered as `APP_INTERCEPTOR` in `app.module.ts`)
 * that writes one `AuditLog` row for every request whose handler carries
 * `@AuditAction(...)` metadata AND whose HTTP method mutates data
 * (POST/PUT/PATCH/DELETE) — STORY-036.
 *
 * Ordering is the single most important detail here: this interceptor must
 * see the response *after* `TransformInterceptor` has wrapped it into
 * `{ success, data }`, not the handler's raw return value, so that
 * `targetId` extraction operates on the real response shape every client
 * actually receives. `TransformInterceptor` is registered via
 * `app.useGlobalInterceptors()` in `main.ts`, which NestJS applies as part
 * of `ApplicationConfig.globalInterceptors` — but only *after*
 * `NestFactory.create()` has already finished scanning `AppModule` and
 * pushed this interceptor (registered there via `APP_INTERCEPTOR`) into
 * that same array first. Since NestJS composes global interceptors in
 * array order with the *first* entry as the outermost wrapper (see
 * `InterceptorsConsumer.intercept()` in `@nestjs/core`), this interceptor —
 * pushed first — ends up outermost, and `TransformInterceptor` — pushed
 * second, from `main.ts` — ends up innermost, closer to the handler. That
 * means this interceptor's `next.handle()` resolves to the *already
 * transformed* `{ success, data }` value. This is verified for real (not
 * just reasoned about) in `audit.interceptor.spec.ts`, which wires both
 * interceptors in a `TestingModule` the same way (`APP_INTERCEPTOR` then
 * `app.useGlobalInterceptors()`) and asserts the audit row's `targetId`
 * really was extracted from the wrapped `data` object.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<
      AuditActionMetadata | undefined
    >(AUDIT_ACTION_KEY, [context.getHandler(), context.getClass()]);

    const request = context.switchToHttp().getRequest<AuditableRequest>();

    if (!metadata || !MUTATING_METHODS.has(request.method)) {
      return next.handle();
    }

    // mergeMap (not tap) so the audit write is genuinely awaited before the
    // response completes — a deliberate correctness-over-latency trade-off
    // (PRD Part B) — while AuditLogService.record() itself never throws, so
    // a transient audit-write failure can never turn this otherwise-
    // successful mutation into an error response.
    return next.handle().pipe(
      mergeMap(async (responseBody: unknown): Promise<unknown> => {
        await this.writeAuditRecord(metadata, request, responseBody);
        return responseBody;
      }),
    );
  }

  private async writeAuditRecord(
    metadata: AuditActionMetadata,
    request: AuditableRequest,
    responseBody: unknown,
  ): Promise<void> {
    // Deliberately strict: only unwrap a `.data` property, never fall back
    // to the raw responseBody. In production this key is always present
    // (barring a pass-through null/undefined for 204s) because
    // TransformInterceptor guarantees it — see this file's class doc
    // comment. A stricter extraction here is what makes the ordering
    // testable at all: if this interceptor were ever wired to run BEFORE
    // TransformInterceptor, `responseBody` would be the handler's raw,
    // un-wrapped return value (no `.data` key), and this would visibly
    // yield `undefined` instead of silently "recovering" by guessing at the
    // whole body.
    const hasDataKey =
      responseBody !== null &&
      typeof responseBody === 'object' &&
      'data' in (responseBody as Record<string, unknown>);
    const data = hasDataKey
      ? (responseBody as Record<string, unknown>).data
      : undefined;

    const tenantId = this.resolveTenantId(metadata, request, data);
    if (tenantId === null) {
      return;
    }

    const user = request.user;
    const actorUserId = user?.userId ?? null;
    const actorLabel = this.auditLogService.buildActorLabel(user);
    const targetId = this.auditLogService.extractTargetId(data);

    await this.auditLogService.record({
      tenantId,
      actorUserId,
      actorLabel,
      action: metadata.action,
      targetType: metadata.targetType,
      targetId,
      metadata: data,
    });
  }

  /**
   * Almost every mutating endpoint in this system is nested under
   * `/tenants/:tenantId/...`, so `request.params.tenantId` is the normal
   * source of truth. `POST /tenants` (tenant *registration* — checklist row
   * 1) is the one deliberate exception: by definition the tenant doesn't
   * exist yet when the request arrives, so there is no `:tenantId` segment
   * in its URL at all. Rather than silently dropping that one checklist
   * row's audit coverage, this falls back to the newly-created tenant's own
   * `tenantId` in the (already-transformed) response body. Any other route
   * with neither a `:tenantId` param nor a `tenantId` in its response is
   * genuinely unanticipated by this design — skip it with a warning rather
   * than throwing (PRD Part B), instead of guessing further.
   */
  private resolveTenantId(
    metadata: AuditActionMetadata,
    request: AuditableRequest,
    data: unknown,
  ): number | null {
    const rawTenantId = request.params?.tenantId;
    if (rawTenantId !== undefined) {
      const tenantId = Number(rawTenantId);
      if (!Number.isInteger(tenantId)) {
        this.logger.warn(
          `@AuditAction("${metadata.action}") — non-integer :tenantId "${rawTenantId}", skipping audit capture`,
        );
        return null;
      }
      return tenantId;
    }

    if (data !== null && typeof data === 'object' && 'tenantId' in data) {
      const responseTenantId = (data as Record<string, unknown>).tenantId;
      if (typeof responseTenantId === 'number') {
        return responseTenantId;
      }
    }

    this.logger.warn(
      `@AuditAction("${metadata.action}") on a route with no :tenantId param and no tenantId in the response — skipping audit capture`,
    );
    return null;
  }
}
