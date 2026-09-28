# STORY-003 — Role-based user invite & permission enforcement

**Service:** backend (uw-backend) · **Mode:** production

**Superseded by STORY-004:** `TenantScopeGuard` (introduced below as a minimal pull-forward) was per-controller `@UseGuards()` at the time this story was written; STORY-004 made it a global `APP_GUARD` instead, so it's automatic for every future `:tenantId` route rather than opt-in. See `STORY-004/impl-notes.md`.

**Follow-up from STORY-005's QA pass:** an independent review found that `resolveOrProvisionUser`'s P2002 handling assumed every unique-constraint conflict was the benign concurrent-SSO-login race it was written for — a conflict on `email` instead (e.g. an SSO user whose email collides with an existing tenant-invited user) silently resolved to `null`, surfacing as an undiagnosable generic 404. Fixed to inspect which constraint actually failed. See `STORY-005/impl-notes.md`.

## Source files

- `src/users/dto/invite-user.dto.ts` — `TENANT_ASSIGNABLE_ROLES` (owner/manager/cashier/inventory_staff/accountant — never `admin`)
- `src/users/tenant-users.controller.ts` — `POST`/`GET /tenants/:tenantId/users`
- `src/users/users.service.ts` — `inviteToTenant()`, `findAllByTenant()`, plus nullable `ssoUserId`/added `tenantId` throughout
- `src/users/users.interface.ts` — `SafeUser`/`InvitedUser` updated for nullable `ssoUserId`, added `tenantId`
- `src/auth/auth.service.ts` — `ResolvedUser` now carries `tenantId`; `resolveUser()` selects it
- `src/auth/guards/tenant-scope.guard.ts` — new (see "Scope creep" below)
- `prisma/schema.prisma` — `User.ssoUserId` now optional, `User.tenantId` added (+ relation), `Role.roleName` now `@unique`
- `prisma/seed.ts` — owner gains `user:create`/`user:read`; manager gains `branch:read`; fixed a real role-upsert race condition (see below)

## Test files

- `src/users/dto/invite-user.dto.ts` validated via existing `class-validator` (no separate spec — `@IsIn` is a one-liner covered by controller tests)
- `src/users/users.service.spec.ts` — extended with `inviteToTenant`/`findAllByTenant` cases
- `src/users/tenant-users.controller.spec.ts` — guard-integration tests (401/403/201/200 + role-whitelist rejection)
- `src/auth/rbac-enforcement.spec.ts` — **real end-to-end integration test**, not mocked (see below)

## Implementation notes

**Real bug #1 — the seed's role upserts had a concurrency race that silently scrambled role↔permission mappings.** `prisma.role.upsert({ where: { roleId: N }, create: { roleName: '...' } })` never pinned an explicit `roleId` in `create`. Running all 6 upserts concurrently via `Promise.all` on the very first (empty-table) run meant Postgres assigned autoincrement IDs in whatever order the concurrent inserts actually committed — not the array's declared order. Every later re-seed's `update: {}` then preserved that scrambled mapping forever, since `where: { roleId: N }` matched "some row" (whichever role ended up at that ID) rather than "the specific named role." Caught only because the new `rbac-enforcement.spec.ts` integration test asserted real behavior against the real seeded database and got a genuinely wrong answer (a manager granted only `branch:read` was denied a branch read, and inspecting the DB directly showed `role_id=2` was actually named `manager`, holding what should have been `owner`'s permissions). Fixed by adding `@unique` to `Role.roleName` and keying every role upsert on `roleName` instead of a hardcoded `roleId` — correct regardless of run order or concurrency. The corrupted local dev database was dropped and rebuilt clean (`dropdb`/`createdb`, `migrate deploy`, reseed) since it held no real data.

**Real bug #2 (a design bug, not just a data bug) — `@Roles('admin')` stacked on top of `@Permissions(...)` made the permission check dead code for every endpoint it touched.** `TenantsController`, `BranchesController`, and the new `TenantUsersController` all originally required `@Roles('admin')` *and* a specific permission — meaning only the `admin` role could ever pass, regardless of what any other role's permissions actually granted. An owner or manager with a real, seeded permission would still be flatly denied by the role check alone. This defeated STORY-003's entire premise (invite a manager, have their role's permissions actually mean something) and was caught by the same integration test. Fixed by removing `@Roles('admin')` from the per-tenant-scoped endpoints (keeping it only on `GET /tenants` — the genuinely cross-tenant, platform-wide listing) and relying on `@Permissions(...)` to do the real authorization work.

**Scope creep, deliberately — a minimal slice of STORY-004 (E-001-04) had to land now.** Removing the blanket `@Roles('admin')` gate exposed a second, more serious gap: permissions are granted per *role* (global), not per *tenant membership*. Without any additional check, a manager invited into tenant 1 could use their `branch:read` permission against tenant 2's branches just by changing the URL — a real cross-tenant leak. Building the full STORY-004 guard wasn't in scope for this story, but leaving this gap open would make STORY-003's own claims false. So a minimal `TenantScopeGuard` was added: for any route with a `:tenantId` path parameter, it checks that the authenticated caller's own `tenantId` (now included in `ResolvedUser`) matches the path — admin accounts (`tenantId: null`) bypass it, since platform admin/support isn't scoped to one tenant. Applied to `TenantsController`, `BranchesController`, and `TenantUsersController`. **This is not all of STORY-004** — background/async job tenant-context propagation and a more general, uniformly-applied mechanism (rather than one guard bolted onto three controllers) remain open for that story.

**The invite mechanism itself.** `POST /tenants/:tenantId/users` creates a `User` row with `tenantId` set and `ssoUserId` left `null` — invited staff have no SSO account yet (pending OQ-06/STORY-005), so `email` is their real unique lookup key. `InviteUserDto.roleName` is restricted via `@IsIn(TENANT_ASSIGNABLE_ROLES)` to the five tenant-facing roles — `admin` is deliberately excluded, since platform admin is provisioned only through internal SSO, never by a tenant owner inviting someone.

**Why the RBAC proof substitutes branches for purchase-orders.** The backlog's literal AC-1 example ("cashier attempts a purchase-order action") can't be tested yet — purchasing is EPIC-004, a later sprint. `rbac-enforcement.spec.ts` proves the identical underlying mechanism (RolesGuard/PermissionsGuard/TenantScopeGuard reading a real invited user's real seeded permissions from the real database) against the nearest actually-protected resource instead: branches. The mechanism doesn't care which resource sits behind it.

## Acceptance criteria status

- [x] AC-1: satisfied — a cashier (seeded with zero permissions) is denied both branch read and branch create (403), verified against the real database in `rbac-enforcement.spec.ts`. Substitutes branches for the not-yet-built purchase-order action (see above).
- [x] AC-2: satisfied — an owner-invited user only gets the actions their assigned role's seeded permissions allow: a manager can read but not create branches, and cannot act on a different tenant's branches at all even with the same permission. Verified end to end, not just asserted.
- [x] AC-3: satisfied — every check (`RolesGuard`, `PermissionsGuard`, and the new `TenantScopeGuard`) runs server-side via NestJS guards reading the resolved user's real roles/permissions/tenantId; nothing is enforced only in a UI (no UI exists yet for this backend-only pass).
