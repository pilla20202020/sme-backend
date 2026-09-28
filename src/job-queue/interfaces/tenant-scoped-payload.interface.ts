/**
 * Any job payload that touches tenant-owned data must extend this and be
 * dispatched via JobQueueService.dispatchForTenant() (not the generic
 * dispatch()) — WorkerService then enforces that the tenant still exists
 * and is active before the handler ever runs, the same way a synchronous
 * request is enforced by TenantScopeGuard (STORY-004 / PRD NF-06).
 */
export interface TenantScopedPayload {
  tenantId: number;
}
