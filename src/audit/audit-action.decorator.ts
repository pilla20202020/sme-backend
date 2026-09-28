import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'auditAction';

export interface AuditActionMetadata {
  action: string;
  targetType: string;
}

/**
 * Marks a mutating route handler for automatic audit capture by the global
 * `AuditInterceptor` (STORY-036). Mirrors `@Roles`/`@Permissions`'
 * `SetMetadata`-based pattern exactly — this decorator does nothing on its
 * own, it only attaches metadata the interceptor reads via `Reflector`.
 */
export const AuditAction = (action: string, targetType: string) =>
  SetMetadata(AUDIT_ACTION_KEY, { action, targetType });
