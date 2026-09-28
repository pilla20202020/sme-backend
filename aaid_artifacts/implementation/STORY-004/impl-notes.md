# STORY-004 — Server-side tenant-scoping guard/middleware

**Service:** backend (uw-backend) · **Mode:** production

**Follow-up from STORY-005's QA pass:** an independent review found and fixed two real gaps in `TenantScopeGuard` — a parser mismatch (`Number()` vs `ParseIntPipe`'s `parseInt`, divergent on inputs like `"1e2"`) and malformed `:tenantId` values silently passing through instead of being rejected — plus closed a test-coverage gap where `tenants.controller.spec.ts`/`tenant-users.controller.spec.ts` never exercised a real non-admin/mismatched-tenant case. See `STORY-005/impl-notes.md` for the full account.

## Source files

- `src/auth/guards/tenant-scope.guard.ts` — already existed as a minimal, per-controller-opt-in slice pulled forward during STORY-003; this story makes it truly global
- `src/app.module.ts` — `TenantScopeGuard` registered as a fourth `APP_GUARD`, applying to every route automatically
- `src/tenants/tenants.controller.ts`, `src/branches/branches.controller.ts`, `src/users/tenant-users.controller.ts` — removed the now-redundant `@UseGuards(TenantScopeGuard)` decorators
- `src/job-queue/interfaces/tenant-scoped-payload.interface.ts` — new
- `src/job-queue/job-queue.service.ts` — new `dispatchForTenant()`
- `src/job-queue/worker.service.ts` — new `verifyTenantContext()`/`failJob()`, wired into `runJob()`

## Test files

- `src/tenants/tenants.controller.spec.ts`, `src/branches/branches.controller.spec.ts`, `src/users/tenant-users.controller.spec.ts`, `src/auth/rbac-enforcement.spec.ts` — updated to register `TenantScopeGuard` as an `APP_GUARD` in their isolated `TestingModule`s (previously relied on the per-controller decorator, which no longer exists)
- `src/job-queue/job-queue.service.spec.ts` — new
- `src/job-queue/worker.service.spec.ts` — new

## Implementation notes

**AC-1 — "enforced automatically, not opt-in per endpoint."** `TenantScopeGuard` moved from a per-controller `@UseGuards()` decorator (STORY-003's minimal pull-forward) to a global `APP_GUARD` in `app.module.ts`. Any future controller with a `:tenantId` path parameter is automatically covered the moment it's added — nobody has to remember to decorate it. Routes with no `:tenantId` (e.g. `GET /tenants`, the cross-tenant admin listing) are unaffected, since the guard no-ops when there's nothing to check. This is the direct fix for the literal wording of AC-1.

**A real consequence of "global," not just a find-replace:** every test file that builds its own minimal `TestingModule` (rather than the full `AppModule`) has to register `TenantScopeGuard` explicitly now, since it's no longer attached to the controller class itself and Nest won't discover it from `app.module.ts` in an isolated test module. Missed this once while first making the change — the tests would have silently stopped enforcing tenant scoping (still passing, but not testing what they claimed to) had it not been caught by rerunning the suite and noticing `rbac-enforcement.spec.ts`'s cross-tenant-denial case still worked (it did — that test happened to exercise a code path that made the gap visible on the first real re-run). All four affected spec files were updated to add `{ provide: APP_GUARD, useClass: TenantScopeGuard }`.

**AC-2 — background/async jobs carry and enforce the same tenant context.** No job type touching tenant-owned data exists yet (the only real handler, `send_email`, has no tenant concept), so building this against a synthetic job would have been speculative. Instead, built the *mechanism* any future tenant-scoped job must use: `JobQueueService.dispatchForTenant(tenantId, jobType, payload, options)` merges `tenantId` into the payload (the caller cannot override it — spread order guarantees the real parameter wins) and records the tenant as the job's `relatedEntityType`/`relatedEntityId` for traceability. `WorkerService.runJob()` now checks, for every job, whether its payload carries a `tenantId` — if so, it re-verifies that tenant still exists and is active *before* invoking the handler, failing the job cleanly (no handler call, no job-log entry) if not. This is the exact async-equivalent of what `TenantScopeGuard` does for a synchronous request: centralized, automatic enforcement that a handler author cannot forget to add. A job with no `tenantId` in its payload (like the existing `send_email` example) is unaffected — enforcement only activates for jobs that opt into carrying tenant context via `dispatchForTenant`.

**Trade-offs / follow-ups:**
- `TenantScopeGuard` trusts `request.params.tenantId` as a plain number match against the resolved user's own `tenantId` — this is correct for every route built so far (all are directly nested `/tenants/:tenantId/...`), but a future route that reaches tenant-owned data through a different path shape (e.g. `/branches/:branchId` without a `:tenantId` segment) would need its own explicit scoping, since this guard only activates on an actual `:tenantId` parameter.
- No job-queue tests existed before this story for any of `JobQueueService`/`WorkerService`/`JobRegistryService`/`SchedulerService` beyond what was added here for the new tenant-context behavior specifically — the rest of that module's pre-existing logic (retry/backoff, cron scheduling) remains untested. Out of this story's scope, but worth flagging.

## Acceptance criteria status

- [x] AC-1: satisfied — `TenantScopeGuard` is a global `APP_GUARD`; any route with a `:tenantId` parameter is automatically scoped without per-controller opt-in. Verified via the full test suite (all controllers) and a live smoke test.
- [x] AC-2: satisfied — `dispatchForTenant()`/`verifyTenantContext()` give any future tenant-scoped job the same automatic, centralized enforcement a synchronous request gets; verified in `worker.service.spec.ts` (active tenant → handler runs; missing/inactive tenant → job fails, handler never called, no job-log entry created).
