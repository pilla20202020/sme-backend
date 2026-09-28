# STORY-005 — Login & session management

**Service:** backend (uw-backend) · **Mode:** production

## Source files

- `src/auth/auth.service.ts` — `login()`, `verifyLocalToken()`, `resolveUserById()`/`resolveUserByWhere()` refactor, `LoginResult` type, local HS256 JWT signing (`AUTH_LOCAL_JWT_SECRET`); also fixes a `resolveOrProvisionUser` bug found by STORY-003's QA review (see below)
- `src/auth/jwt-auth.guard.ts` — branches verification between SSO (RS256/JWKS) and local (HS256) tokens by a `tokenType` claim; cache keys now namespaced (`sso:<id>` / `local:<id>`) to prevent a numeric-ID collision between the two spaces
- `src/auth/dto/login.dto.ts` — new
- `src/auth/auth.controller.ts` — new `POST /auth/login`
- `src/auth/guards/tenant-scope.guard.ts` — fixes two STORY-004 QA findings (see below)
- `src/users/dto/invite-user.dto.ts` — `password` now required on invite
- `src/users/users.service.ts` — `inviteToTenant` now bcrypt-hashes the password
- `prisma/schema.prisma` — `User.passwordHash` added

## Test files

- `src/auth/auth.service.spec.ts` — `login`, `verifyLocalToken`, plus the `resolveOrProvisionUser` email-collision fix
- `src/auth/jwt-auth.guard.spec.ts` — local-token branch, SSO/local cache-key collision test
- `src/auth/guards/tenant-scope.guard.spec.ts` — new, direct unit tests for the STORY-004 parser fixes
- `src/users/users.service.spec.ts` — password hashing assertions
- `src/users/tenant-users.controller.spec.ts`, `src/tenants/tenants.controller.spec.ts` — add real non-admin/mismatched-tenant cases (STORY-004 QA test-coverage gap)

## Implementation notes

**OQ-06 provisional resolution (flagged, not silently assumed).** The PRD carries OQ-06 ("identity provider strategy") as an explicitly open business/engineering decision. Building STORY-005 required *some* answer: the existing SSO/JWKS flow is for platform-admin/support only (external IdP, `ssoUserId`), and tenant-invited staff (STORY-003) have no SSO account at all — without a resolution here, nobody but the platform admin could ever log in. Went with the simplest MVP-honest answer: email/password login for tenant staff, self-signed HS256 JWTs (`AUTH_LOCAL_JWT_SECRET`), stored as the same `uw_access_token` cookie. This is provisional — revisit once OQ-06 is actually decided; the two auth paths are cleanly separated by a `tokenType` claim so replacing this one later doesn't touch the SSO path at all.

**No email-invite flow yet.** Since `send_email` is still a logging stub (no real email infrastructure), `InviteUserDto.password` is required — the inviter sets an initial password directly and communicates it out of band. A real invite-link/set-password flow is a natural follow-up once email sending is real; noted as a trade-off, not silently glossed over.

**Cache-key collision, caught before shipping.** `JwtAuthGuard`'s resolved-user cache was originally keyed by a bare number. Since SSO's `ssoUserId` (assigned by an external IdP) and a local user's own `userId` (our autoincrement PK) are different numbering spaces, the same number could mean two different people — a bare-number cache key could have served one user's session data under another user's token. Fixed by namespacing cache keys (`sso:<id>` / `local:<id>`); covered by a dedicated test forcing both branches to use the same numeric id.

**QA fixes carried over from STORY-003 and STORY-004 (applied here since login touches the same code paths):**
- STORY-003 finding: `resolveOrProvisionUser`'s P2002 catch assumed every unique-constraint conflict was a benign concurrent-SSO-login race. Now inspects `err.meta.target` — a conflict on `sso_user_id` is still treated as that race, but any other conflict (most plausibly `email`, e.g. an SSO user whose email matches an existing tenant-invited user) now fails loudly with a specific `InternalServerErrorException` and a logged diagnostic, instead of silently resolving to `null` and surfacing as a generic, undiagnosable 404.
- STORY-004 finding #1: `TenantScopeGuard` used `Number(request.params.tenantId)`, which disagrees with `ParseIntPipe`'s `parseInt` on inputs like `"1e2"` (`Number` → 100, `parseInt` → 1) — a real guard/controller parsing mismatch. Fixed: the guard now requires the raw path segment to match `/^\d+$/` before parsing, rejecting anything that isn't plain decimal digits.
- STORY-004 finding #2: a malformed (non-numeric) `:tenantId` previously fell through the guard silently (treated identically to "no tenantId param"). Now rejected outright with `ForbiddenException` rather than relying on a downstream `ParseIntPipe` to catch it.
- STORY-004 finding #3 (test-coverage gap): `tenants.controller.spec.ts` and `tenant-users.controller.spec.ts` previously used `roles: ['admin']` for every test user, so `TenantScopeGuard`'s actual reject branch was never exercised in those files (only bypassed via the admin shortcut). Added real non-admin/mismatched-tenant cases to both.

**End-to-end verified against a live server** (not just unit tests): registered a tenant, inserted a manager-role user directly (simulating an owner's invite, since generating a real SSO JWT isn't possible in this sandbox), then confirmed via real HTTP calls: wrong password → 401; correct password → 200 with a session cookie carrying the manager's real role/permissions; the cookie correctly allows reading the manager's own tenant's branches (200), denies creating one (403, no `branch:create`), denies reading a *different* tenant's branches (403, `TenantScopeGuard`), and `GET /auth/me` reflects the session; `POST /auth/logout` clears the cookie and subsequent requests correctly 401.

## QA follow-up (post-review)

An independent senior-QA pass verdicted PASS on both ACs and confirmed every specific claim above by diffing against pre-story commits and re-running the affected tests directly — nothing was overstated. Three informational findings, accepted as MVP trade-offs rather than fixed now (each was explicitly framed as non-blocking by the review itself):
- `login()`'s miss paths (no such user / SSO-only account) return faster than the wrong-password path (which pays a real bcrypt.compare), a timing side-channel that could let an attacker distinguish account states despite the identical 401 message. Low severity; fix later by always running a dummy bcrypt.compare on the miss paths.
- The dev-only JWT secret fallback activates whenever `NODE_ENV` isn't exactly `"production"` — matches an existing convention already used elsewhere in this codebase (main.ts's CORS/cookie `secure` flag), not a new risk introduced here, but worth a deployment-checklist note to confirm `NODE_ENV=production` and `AUTH_LOCAL_JWT_SECRET` are both actually set before any real deployment.
- `POST /auth/login` has no route-specific rate limiting beyond the generic global `ThrottlerGuard` (60 req/min) — a reasonable MVP trade-off, but login endpoints are a typical first brute-force target; worth a backlog note for a dedicated limiter later.

## Acceptance criteria status

- [x] AC-1: satisfied — `POST /auth/login` with valid email/password returns a session (cookie) carrying the caller's own tenant and role/permissions; verified both in unit tests and against a live server.
- [x] AC-2: satisfied — an expired or invalid session token is rejected with 401 (`verifyLocalToken` throws `UnauthorizedException` on expiry/bad signature/wrong claim), not silently treated as authenticated; the client is expected to re-authenticate via `POST /auth/login`, matching the existing SSO session's re-auth pattern.
