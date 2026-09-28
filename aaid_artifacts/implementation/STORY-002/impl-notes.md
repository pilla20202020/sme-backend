# STORY-002 — Branch management

**Service:** backend (uw-backend) · **Mode:** production

## Source files

- `src/branches/branches.module.ts`
- `src/branches/branches.controller.ts`
- `src/branches/branches.service.ts`
- `src/branches/branches.interface.ts`
- `src/branches/dto/create-branch.dto.ts`
- `prisma/schema.prisma` — added `Branch` model + `Tenant.branches` back-relation
- `src/app.module.ts` — registered `BranchesModule`
- `prisma/seed.ts` — added `branch:create`/`branch:read` permissions, granted to admin and owner

## Test files

- `src/branches/branches.service.spec.ts`
- `src/branches/branches.controller.spec.ts` (real guard-integration tests, not placeholders — see notes)

## Implementation notes

**Nesting and scoping.** Routes are nested under `/tenants/:tenantId/branches` rather than a flat `/branches?tenantId=`, matching the tenant-scoped-by-path pattern STORY-001 established (no session-based "current tenant" exists yet — that's STORY-004/005). `create()` and `findAll()` both verify the tenant exists first (404 if not); `findById()` requires the branch's stored `tenantId` to match the path's `tenantId` via `findFirst({ where: { branchId, tenantId } })` — a branch belonging to a different tenant is indistinguishable from a nonexistent one, so guessing another tenant's branch ID by ID alone leaks nothing.

**Permissions gated the same way as STORY-001, deliberately.** All three endpoints require `@Roles('admin')` plus a resource permission (`branch:create`/`branch:read`) — consistent with tenant reads. Real per-tenant-owner RBAC (so an Owner can manage only their own tenant's branches without being a platform admin) is STORY-003's job; gating everything behind admin for now is an honest placeholder, not a shortcut, since no other role currently holds any permissions to check.

**QA follow-through from STORY-001's review.** Before starting this story, addressed the senior QA review's findings on STORY-001:
- Replaced both `tenants.controller.spec.ts` and (proactively) `branches.controller.spec.ts`'s placeholder `should be defined` tests with real guard-integration tests — a `TestingModule` wired with the actual `JwtAuthGuard`/`RolesGuard`/`PermissionsGuard` (via `APP_GUARD`) and a mocked `AuthService`, driven through `supertest`. These now assert, for real: `POST /tenants` works with zero auth cookie; `GET /tenants/:id` 401s with no cookie, 403s for a non-admin role, 403s for an admin missing the specific permission, and 200s only when both role and permission are satisfied. Same coverage pattern applied to branches.
- `CreateTenantDto.name` now trims via `@Transform` before `@MinLength` runs, so whitespace-only names are rejected (new `create-tenant.dto.spec.ts`).
- `CreateTenantDto.currency` now requires `@Matches(/^[A-Z]{3}$/)` instead of just length-3, rejecting `"npr"`/`"123"`.
- Added a clarifying schema comment on `Tenant.batchExpiryTrackingEnabled`'s DB-level default, noting it's a fallback only — the real vertical-driven value is always set by the service.
- Did not change: the open-registration endpoint still relies only on the global `ThrottlerGuard` — QA flagged this as an accepted trade-off for this MVP milestone, not a blocker.

## QA follow-up (post-review)

An independent senior-QA pass verdicted PASS (AC-1) / PASS-WITH-FINDINGS (AC-2) plus 4 ranked findings. Addressed:
- `CreateBranchDto.name`/`address` now trim via `@Transform`, closing the same whitespace-only-name gap already fixed on `CreateTenantDto` (new `create-branch.dto.spec.ts`).
- Added a real HTTP-level cross-tenant isolation test (`branches.controller.spec.ts`, second `describe` block) — wires the **actual** `BranchesService` (not a mock) against a small two-tenant in-memory fake `PrismaService`, driven through `supertest`: confirms tenant 1 can fetch its own branch, and both cross-tenant fetch directions 404 through the real Express routing, not just at the mocked-service unit-test level.
- Corrected the AC-2 status below — QA rightly pointed out the backlog's AC-2 is actually about *report* filtering (E-009 scope, not yet built); what exists here is a precondition for it, not the AC itself.

Not changed (accepted, tracked as follow-ups rather than blockers): `Branch.isActive` has no deactivate/archive endpoint yet — "management" beyond create+read is out of this story's literal ACs.

## Superseded by STORY-003

`@Roles('admin')` was removed from all three `BranchesController` endpoints during STORY-003 — it was stacked on top of `@Permissions(...)` in a way that made the permission check dead code (only `admin` could ever pass, regardless of what any other role's permissions granted, which broke STORY-003's whole premise). Authorization is now `@Permissions(...)` plus a new `TenantScopeGuard` (checks the caller's own tenant matches the `:tenantId` path). See `STORY-003/impl-notes.md` for the full account — this note exists so this file doesn't silently go stale.

## Acceptance criteria status

- [x] AC-1: satisfied — creating a branch under a tenant makes it immediately retrievable via `GET /tenants/:tenantId/branches` and `GET /tenants/:tenantId/branches/:branchId`; verified in `branches.service.spec.ts` and, after the QA follow-up, at the real HTTP layer in `branches.controller.spec.ts`.
- [~] AC-2: precondition satisfied, not the full AC — `findAll`/`findById` are correctly tenant-scoped (no cross-tenant leakage, verified at both the service and HTTP layers), which is what per-branch/all-branch *report* filtering (the literal AC-2 wording) will need. The reporting feature itself is E-009 (Dashboard & Reporting), not yet built — re-verify this AC when that epic lands.
