# STORY-037 — Admin/Support audit query & filter UI

**Service:** backend (uw-backend) · **Mode:** production

## Source files

- `src/audit/audit-logs.controller.ts` — `GET /tenants/:tenantId/audit-logs`, `@Roles('admin')` + `@Permissions('audit:read')`
- `src/audit/dto/list-audit-logs-query.dto.ts` — `ListAuditLogsQueryDto extends PaginationQueryDto` with optional `actorUserId`/`action`/`from`/`to`, all combinable
- `src/audit/audit-log.service.ts` — `findAll()` (shared file with STORY-036's write path, since it's the same table/service)
- `src/audit/audit-logs.interface.ts` — `AuditLogResponse` (BigInt `id` mapped to `string`, matching the existing `ProductPriceHistoryResponse.id` precedent), `PaginatedResult<T>`
- `prisma/seed.ts` — `audit:read` permission (see STORY-036's notes — admin-only, deliberately not granted to owner/manager)

## Test files

- `src/audit/audit-logs.controller.spec.ts` — real guard-integration tests: no cookie → 401; a tenant `owner` (even for their own tenant, with `audit:read` explicitly granted) → 403; an admin missing `audit:read` → 403; an admin with `audit:read` → 200; a combined `actorUserId`+`action`+`from`+`to` query forwarded correctly to the service
- `src/audit/audit-log.service.spec.ts` — `findAll()` unit tests: filters combine correctly, filters are omitted from the `where` clause when not provided, BigInt `id` → string mapping, pagination math

## Implementation notes

**Admin-only is enforced by `@Roles('admin')`, not by `TenantScopeGuard`.** `TenantScopeGuard` (global `APP_GUARD`) actually *bypasses its own tenant-match check entirely* for the `admin` role (`if (user.roles.includes('admin')) return true;` — see `tenant-scope.guard.ts`), which is exactly the behavior this endpoint needs: an admin can query *any* tenant's audit log, not just one they're scoped to (admins have `tenantId: null` and aren't scoped to any single tenant by design). The actual restriction against everyone else — including a tenant's own `owner`, who would otherwise pass `TenantScopeGuard`'s tenant-match check just fine — comes from `RolesGuard` rejecting anything that isn't `admin`, which runs *before* `TenantScopeGuard` in the `APP_GUARD` order declared in `app.module.ts`. Verified directly: `audit-logs.controller.spec.ts`'s owner-denial test grants the owner `audit:read` explicitly (so a pass would prove nothing about permissions and everything about the role check) and still gets 403.

**Filters are independent and combinable, not mutually exclusive.** `AuditLogService.findAll()` builds the Prisma `where` clause by spreading in each filter only if it was actually provided (`...(query.actorUserId != null ? {...} : {})`, same pattern as `PurchaseOrdersService.findAll`'s optional `status` filter) — any subset of `actorUserId`/`action`/`from`/`to` can be present simultaneously, and `from`/`to` compose into a single `createdAt: { gte, lte }` range rather than two separate (and Prisma-overwriting) `createdAt` keys.

**No separate response-mapping bug for `BigInt`.** `AuditLog.id` is a `BigInt` (same as `Job.id`/`JobLog.id` elsewhere in this codebase); `JSON.stringify` (which Express's `res.json()` uses) throws on a raw `BigInt`, so `mapAuditLog()` explicitly calls `.toString()` on it before it ever reaches a response — the exact same pattern `JobQueueController.getJob()` already uses, and covered directly in `audit-log.service.spec.ts` (`expect(typeof result.data[0].id).toBe('string')`).

## Live smoke-test evidence

Using the same live server / tenant / owner session from STORY-036's smoke test, plus a second, dedicated `admin`-role test user (created fresh via a direct DB insert with a local password — not the seeded `admin@aismeplatform.com` account, which was left untouched — again mirroring STORY-005's "no real SSO token available in this sandbox" precedent):

- `GET /tenants/124/audit-logs` as the **owner** → **403**, even though that owner was granted `audit:read` explicitly for this test (proving the block is the `@Roles('admin')` check, not a missing permission).
- `GET /tenants/124/audit-logs` with **no cookie at all** → **401**.
- `GET /tenants/124/audit-logs` as the **admin** test user → **200**, returning both real rows from STORY-036's smoke test (the anonymous `tenant.create` row and the authenticated `branch.create` row), confirming `actorLabel: "Anonymous (public endpoint)"` is genuinely visible through this query endpoint, not just present in the raw table.
- `GET /tenants/124/audit-logs?action=branch.create&actorUserId=66` as the admin → returned only the one matching row (`meta.total: 1`), confirming the combined filters work against real data, not just mocks.

## Acceptance criteria status

- [x] AC-1: satisfied — `actorUserId`/`action`/`from`/`to` filters combine correctly; verified in `audit-log.service.spec.ts` (mocked-Prisma `where`-clause assertions) and live (`?action=branch.create&actorUserId=66` returned exactly the one matching row out of two total).
- [x] AC-2: satisfied — a caller without the `admin` role is denied with 403, including a tenant's own `owner` even when explicitly granted `audit:read` for the test. Verified in `audit-logs.controller.spec.ts` and live (`curl` as the owner returned 403; as a dedicated admin test user, 200).

No judgment calls beyond what's already noted in STORY-036's impl-notes (both stories share the interceptor-ordering and tenantId-fallback reasoning, since STORY-037 only adds the read side on top of STORY-036's write path).
