# STORY-001 — Tenant registration & business profile

**Service:** backend (uw-backend) · **Mode:** production

## Source files

- `src/tenants/tenants.module.ts`
- `src/tenants/tenants.controller.ts`
- `src/tenants/tenants.service.ts`
- `src/tenants/tenants.interface.ts`
- `src/tenants/dto/create-tenant.dto.ts`
- `prisma/schema.prisma` — added `Tenant` model + `Vertical` enum
- `src/app.module.ts` — registered `TenantsModule`

## Test files

- `src/tenants/tenants.service.spec.ts`
- `src/tenants/tenants.controller.spec.ts`

## Implementation notes

**Scope boundary.** STORY-001 is scoped to registering the business/tenant record itself — not the owner's login credentials. `POST /tenants` is marked `@Public()` and unauthenticated by design (confirmed with the user before implementation): STORY-005 (login & session) is blocked on the identity-provider decision (OQ-06) and will wire real auth to this endpoint once that lands. `GET /tenants/:id` and `GET /tenants` are `admin`-only for now (mirroring `UsersController`'s pattern) since there's no session yet to resolve "which tenant is this caller's own" — that self-service lookup is deferred to land alongside STORY-005.

**Vertical-driven defaults, not free-form choice.** `batchExpiryTrackingEnabled` is computed server-side from the vertical (`true` for pharmacy, `false` otherwise) rather than accepted as a DTO field — the PRD (FR-01 AC-3) specifies pharmacy-vertical settings are enabled *by default*, not configurable at registration. `currency` defaults to `NPR` and `vertical` defaults to `pharmacy`, matching the project's locked-in vertical decision.

**Prerequisite codebase strip (out of the four-section template, but required before this story could exist).** Before writing the Tenant module, the user asked to remove uw-backend's inherited enrollment/underwriting-domain code wholesale rather than incrementally: `src/modules/{enrollments,underwriting-sync,dashboard,activity-logs}/`, `src/infrastructure/{nuera,benefit-store,ai-recommendation,message-center}/`, and `src/common/eligibility/` were deleted; `prisma/schema.prisma` was trimmed from 33 models/13 enums to 8 models/2 enums (kept: `Role`, `Permission`, `User`, `UserRole`, `RolePermission`, `Job`, `JobLog`, `RecurringJobSchedule`, `JobStatus`, plus the new `Tenant`/`Vertical`); `prisma/migrations/` (28 enrollment-era migrations) was deleted for a future clean re-baseline; `prisma/seed.ts` was rewritten to seed pharmacy-domain RBAC roles (owner/manager/cashier/inventory_staff/accountant/admin per BRD §6) instead of insurance fixtures; `app.module.ts`, `main.ts`, `s3.service.ts`, `winston.config.ts`, and `auth.service.ts`'s SSO role map were genericized. Full dependency analysis is preserved in this session's exploration-agent report; nothing outside the confirmed removal list was touched.

**Database migration applied — against a new local database, not the QA RDS instance.** `uw-backend/.env`'s `DATABASE_URL` originally pointed at what appears to be the original enrollment project's shared QA RDS instance (`qa-sso-db`, database `underwriting_db`) — not a database dedicated to AI SME. Running a migration against it would have dropped ~20 live tables from an unrelated project, so that was never done. Instead: created a local PostgreSQL 18 database `ai_sme_dev` (already running as a Windows service) with a dedicated `ai_sme_app` role, pointed `.env` at it, and ran `prisma migrate dev --name init` — this produced the real baseline migration now committed at `prisma/migrations/20260907070740_init/`.

**Real bug caught by manual smoke testing (not by unit tests).** Started the server for real and hit `POST /tenants` end to end. The seed script's `prisma.tenant.upsert` hardcodes `tenantId: 1` for the sample tenant; this doesn't advance Postgres's autoincrement sequence, so the very next real registration collided with a `P2002` unique-constraint error on `tenant_id`. Unit tests never caught this because they mock `PrismaService` entirely. Fixed by adding an explicit `setval(pg_get_serial_sequence(...))` sequence reset at the end of `prisma/seed.ts`, right after the hardcoded-ID insert. Re-verified: two consecutive registrations now get sequential IDs (2, 3) with no collision, admin-gated reads correctly 401 without auth, and DTO validation correctly 400s on a too-short name.

**Trade-offs / follow-ups:**
- No uniqueness constraint on `Tenant.name` — two businesses can share a display name (e.g. two unrelated "City Pharmacy"s), which is realistic and matches the BRD's lack of a stated constraint here.
- `findAll`/`findById` being admin-gated is a deliberate narrowing versus a fully general "tenant-scoped self-service" read, tracked against STORY-005.
- A pre-existing, unrelated bug was noticed during verification: `app.service.ts`'s `getHello()` returns `'Hello Woasd asrld!'` instead of `'Hello World!'`, failing `app.controller.spec.ts`. Not touched — out of this story's scope — flagging for a trivial follow-up fix.

## Superseded by STORY-003

`GET /tenants/:id` (renamed `:tenantId`) no longer requires `@Roles('admin')` — that was stacked on top of `@Permissions('tenant:read')` in a way that made the permission check dead code (only `admin` could ever pass). It's now `@Permissions('tenant:read')` plus a new `TenantScopeGuard` restricting the caller to their own tenant (admin bypasses, since platform admin isn't scoped to one tenant). `GET /tenants` (the cross-tenant, list-everything endpoint) correctly kept `@Roles('admin')`. See `STORY-003/impl-notes.md` for the full account.

## QA follow-up (post-review)

An independent senior-QA pass verdicted PASS on all three ACs, with one Medium and three Low findings. All were addressed before this story was marked done (see `STORY-002/impl-notes.md` for the detail, since the fixes landed alongside that story): real guard-integration tests replaced the placeholder controller specs, `name` now trims before length validation, `currency` now requires a real 3-letter uppercase code, and the DB-level `batchExpiryTrackingEnabled` default got a clarifying comment. The one accepted trade-off (registration relying only on generic rate-limiting, no captcha/dedup) was left as-is per QA's own recommendation for this MVP milestone.

## Acceptance criteria status

- [x] AC-1: satisfied — `POST /tenants` creates a `Tenant` row with its own isolated data space (own primary key, no shared state with any other tenant); verified in `tenants.service.spec.ts` (`register` tests).
- [x] AC-2: satisfied at this story's scope — `findById`/`findAll` never return another tenant's data implicitly (every read requires an explicit `tenantId`, verified with a two-tenant test in `tenants.service.spec.ts`). Cross-cutting, automatic tenant-scoping enforcement across *all* future modules (so a caller literally cannot query past their own tenant even by trying) is STORY-004's job (`E-001-04`, tenant-scoping guard/middleware) — not yet built, since no other tenant-owned resource exists yet to scope.
- [x] AC-3: satisfied — selecting (or defaulting to) the `pharmacy` vertical sets `batchExpiryTrackingEnabled: true` automatically; verified in `tenants.service.spec.ts`.
