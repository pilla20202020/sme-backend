# Authentication & RBAC

This document covers how SSO authentication and role-based access control (RBAC) work in `uw-backend`. Read this before touching any guard, decorator, or auth-related service.

---

## Table of Contents

1. [SSO Authentication](#1-sso-authentication)
   - [Overview](#overview)
   - [Environment Variables](#environment-variables)
   - [How JWT Verification Works](#how-jwt-verification-works)
   - [JWKS Key Caching](#jwks-key-caching)
   - [The JwtAuthGuard](#the-jwtauthguard)
   - [User Cache](#user-cache)
   - [Opting Out of Auth on a Route](#opting-out-of-auth-on-a-route)
2. [RBAC](#2-rbac)
   - [Database Schema](#database-schema)
   - [Permission Naming Convention](#permission-naming-convention)
   - [Guard Execution Order](#guard-execution-order)
   - [RolesGuard](#rolesguard)
   - [PermissionsGuard](#permissionsguard)
   - [Using Both Guards Together](#using-both-guards-together)
3. [Decorators Reference](#3-decorators-reference)
4. [Request Lifecycle](#4-request-lifecycle)
5. [Adding New Roles and Permissions](#5-adding-new-roles-and-permissions)
6. [Common Pitfalls](#6-common-pitfalls)

---

## 1. SSO Authentication

### Overview

The backend does **not** issue or store passwords. All identity is delegated to an external SSO Module. The SSO provider issues RS256-signed JWTs. This service verifies those tokens by fetching the provider's public keys from its JWKS (JSON Web Key Set) endpoint.

```
Client                    uw-backend               SSO Provider
  |                           |                         |
  |── POST /auth/token ──────>|  (handled by SSO,       |
  |<── access_token ──────────|   not this service)     |
  |                           |                         |
  |── GET /some/route ───────>|                         |
  |   Authorization: Bearer   |── GET /.well-known/ ──>|
  |   <access_token>          |   jwks.json            |
  |                           |<── { keys: [...] } ────|
  |                           |                         |
  |                           | verify RS256 signature  |
  |                           | lookup user in DB       |
  |                           | attach roles/perms      |
  |<── 200 OK ────────────────|                         |
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SSO_JWKS_URI` | Yes | JWKS endpoint URL, e.g. `https://your-sso.example.com/.well-known/jwks.json` |
| `SSO_ISSUER` | No | Expected `iss` claim. Omit to skip issuer validation. |
| `SSO_AUDIENCE` | No | Expected `aud` claim. Omit to skip audience validation. |
| `AUTH_JWKS_URI` | Fallback | Alias for `SSO_JWKS_URI`, checked second. |
| `AUTH_ISSUER` | Fallback | Alias for `SSO_ISSUER`. |
| `AUTH_AUDIENCE` | Fallback | Alias for `SSO_AUDIENCE`. |
| `CORS_ORIGIN` | Yes (prod) | Allowed origin for CORS, e.g. `https://app.example.com`. Required in `NODE_ENV=production`. |

The service will throw at startup if `CORS_ORIGIN` is unset in production. It will throw `401` on the first request if `SSO_JWKS_URI` is unset.

### How JWT Verification Works

Implemented in `src/auth/auth.service.ts → verifyAccessToken()`.

1. **Decode header** — `jwt.decode(token, { complete: true })` extracts the `kid` (key ID) from the token header without verifying the signature. This is safe because we only use `kid` to select the public key; the actual signature verification happens in step 3.

2. **Fetch the public key** — `getSigningKey(kid)` looks up the matching public key from the JWKS cache. If the cache is stale or missing the `kid`, it refreshes from `SSO_JWKS_URI`.

3. **Verify the signature** — `jwt.verify(token, publicKey, { algorithms: ['RS256'], issuer, audience })` validates:
   - RS256 signature against the public key
   - `exp` (expiry) claim
   - `iss` (issuer) claim, if `SSO_ISSUER` is configured
   - `aud` (audience) claim, if `SSO_AUDIENCE` is configured

4. **Validate `sub`** — The `sub` claim must be present. It identifies the SSO user.

5. **Return payload** — Returns `AccessTokenPayload` (a `JwtPayload` with a guaranteed `sub: string`).

Errors thrown during verification propagate as-is if they are `UnauthorizedException` (e.g., missing `kid`, missing `sub`). Unknown errors (network failures, malformed keys) are wrapped in a generic `UnauthorizedException('Invalid access token')` to avoid leaking internal detail.

### JWKS Key Caching

Public keys are cached in memory in a `Map<kid, pem>` with a 5-minute TTL (`cacheTtlMs = 5 * 60 * 1000`).

```
getSigningKey(kid)
  ├── key in cache AND cache is fresh?  → return cached PEM immediately
  ├── refresh already in progress?      → await the pending promise (no duplicate fetch)
  └── cache stale / key missing?        → call refreshJwks()
          ├── GET {SSO_JWKS_URI}
          ├── parse RSA keys
          ├── keyCache.clear()
          ├── populate keyCache with new PEMs
          └── update lastCacheRefresh timestamp
```

A single `pendingRefresh` promise prevents concurrent cache refreshes under load. All concurrent requests that arrive while a refresh is in progress await the same promise.

### The JwtAuthGuard

`src/auth/auth.service.ts` handles token verification; `src/auth/jwt-auth.guard.ts` is the NestJS guard that wires verification into the request pipeline.

**What it does per request:**

1. Checks whether the route/controller is decorated `@Public()`. If yes, returns `true` immediately — no auth required.
2. Reads the `Authorization` header. Expects `Bearer <token>`.
3. Calls `authService.verifyAccessToken(token)` to get the JWT payload.
4. Parses `payload.sub` as a number (`ssoUserId`). Throws `401` if the value is not a finite integer (e.g., a UUID-style sub).
5. Looks up the user in the database (or the in-memory cache — see below).
6. Throws `401` if the user doesn't exist or `isActive` is `false`.
7. Collects the user's roles and flattened permissions from the DB result.
8. Sets `request.user` to the merged payload + DB data.

**`request.user` shape after the guard runs:**

```typescript
type AuthenticatedUser = {
  // JWT claims (from AccessTokenPayload / JwtPayload)
  sub: string;         // SSO user ID (string form)
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
  // DB-derived fields
  userId: number;      // internal DB primary key
  roles: string[];     // e.g. ['admin', 'underwriter']
  permissions: string[]; // e.g. ['user:read', 'enrollment:approve']
};
```

### User Cache

To avoid a deep Prisma join (user → roles → permissions) on every request, the guard caches each user's `userId`, `roles`, and `permissions` in memory for **30 seconds**, keyed by `ssoUserId`.

```typescript
private readonly userCache = new Map<number, { data: CachedUserData; expiresAt: number }>();
private readonly cacheTtlMs = 30_000;
```

**Consequence:** Role and permission changes take up to 30 seconds to take effect for already-authenticated users. This is acceptable for this application's use case. If you need immediate revocation, either reduce `cacheTtlMs` or call `userCache.delete(ssoUserId)` in the service that modifies roles.

The JWKS key cache and the user data cache are separate:
- JWKS cache: 5 minutes, keyed by JWT `kid`
- User cache: 30 seconds, keyed by `ssoUserId`

### Opting Out of Auth on a Route

Decorate the handler (or the whole controller) with `@Public()`:

```typescript
import { Public } from '../auth/public.decorator';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  check() {
    return { status: 'ok' };
  }
}
```

When `@Public()` is present, `JwtAuthGuard` returns `true` without reading the `Authorization` header. `RolesGuard` and `PermissionsGuard` still run but pass through immediately because `request.user` won't have roles/permissions metadata attached.

---

## 2. RBAC

### Database Schema

RBAC is implemented with four tables:

```
users ──── user_roles ──── roles ──── role_permissions ──── permissions
  │              │            │                 │                  │
userId      userId/roleId  roleId         roleId/permId       permissionId
ssoUserId                  roleName                            resource
                           description                         action
                                                               name (unique)
```

**`roles`** — named roles, e.g. `admin`, `underwriter`, `viewer`.

**`permissions`** — fine-grained capabilities. Each has:
- `resource` — the entity it applies to, e.g. `enrollment`, `user`
- `action` — what can be done, e.g. `read`, `create`, `approve`
- `name` — the combined string used in code: `resource:action`, e.g. `enrollment:approve`

**`user_roles`** — many-to-many join: assigns roles to users. `assignedAt` is recorded for audit.

**`role_permissions`** — many-to-many join: assigns permissions to roles.

A user's effective permissions are the union of all permissions across all their roles.

### Permission Naming Convention

Permissions follow `resource:action` format:

```
user:read           — list/view users
user:create         — create a new user
enrollment:read     — view enrollments
enrollment:create   — submit a new enrollment
enrollment:approve  — approve pending underwriting
enrollment:activate — mark an enrollment active
enrollment:term     — terminate an enrollment
```

The `name` column in the `permissions` table holds this string and has a `UNIQUE` constraint.

### Guard Execution Order

All three guards are registered globally in `AppModule` as `APP_GUARD` providers:

```typescript
// app.module.ts
{ provide: APP_GUARD, useClass: ThrottlerGuard },     // 1st — rate limiting
{ provide: APP_GUARD, useClass: JwtAuthGuard },        // 2nd — identity
{ provide: APP_GUARD, useClass: RolesGuard },          // 3rd — role check
{ provide: APP_GUARD, useClass: PermissionsGuard },    // 4th — permission check
```

NestJS executes `APP_GUARD` providers in declaration order. A request must pass all four to reach the handler. If any guard throws, subsequent guards do not run.

### RolesGuard

`src/auth/guards/roles.guard.ts`

Reads the `roles` metadata set by `@Roles(...)` and checks whether `request.user.roles` contains **any** of the required roles (OR logic).

```typescript
const hasRole = user.roles.some(role => requiredRoles.includes(role));
```

If no `@Roles(...)` decorator is present, the guard passes through (`return true`).

### PermissionsGuard

`src/auth/guards/permissions.guard.ts`

Reads the `permissions` metadata set by `@Permissions(...)` and checks whether `request.user.permissions` contains **all** of the required permissions (AND logic).

```typescript
const hasAllPermissions = requiredPermissions.every(perm => user.permissions.includes(perm));
```

If no `@Permissions(...)` decorator is present, the guard passes through.

### Using Both Guards Together

When both `@Roles` and `@Permissions` are applied to the same endpoint, **both** checks must pass independently:

```typescript
@Post()
@Roles('admin')
@Permissions('user:create')
create(@Body() dto: CreateUserDto) { ... }
```

This means the caller must:
- Have the `admin` role **AND**
- Have the `user:create` permission

Always apply `@Permissions` alongside `@Roles` for endpoints that mutate data. Relying solely on `@Roles` means any admin — regardless of their specific permission set — can reach the endpoint.

---

## 3. Decorators Reference

All auth decorators are exported from `src/auth/decorators/index.ts`.

### `@Public()`

**File:** `src/auth/public.decorator.ts`

Marks a route as unauthenticated. `JwtAuthGuard` skips token verification entirely.

```typescript
import { Public } from '../auth/public.decorator';

@Get('ping')
@Public()
ping() { return 'pong'; }
```

### `@Roles(...roles)`

**File:** `src/auth/decorators/roles.decorator.ts`

Restricts a route to users who have at least one of the listed roles.

```typescript
import { Roles } from '../auth/decorators';

@Get()
@Roles('admin', 'underwriter')
listEnrollments() { ... }
```

### `@Permissions(...permissions)`

**File:** `src/auth/decorators/permissions.decorator.ts`

Restricts a route to users who have **all** of the listed permissions.

```typescript
import { Permissions } from '../auth/decorators';

@Patch(':id/approve')
@Permissions('enrollment:approve')
approve(@Param('id') id: string) { ... }
```

### `@CurrentUser()`

**File:** `src/auth/decorators/current-user.decorator.ts`

Parameter decorator that injects `request.user` as `AuthenticatedUser`. Use this instead of `@Req()` whenever you need the authenticated user in a handler.

```typescript
import { CurrentUser } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';

@Get('profile')
getProfile(@CurrentUser() user: AuthenticatedUser) {
  return { userId: user.userId, roles: user.roles };
}
```

---

## 4. Request Lifecycle

The full path from an incoming HTTP request to the handler:

```
HTTP Request
    │
    ▼
ThrottlerGuard
    │  fail → 429 Too Many Requests
    ▼
JwtAuthGuard
    │  @Public()?           → skip to RolesGuard (request.user not set)
    │  no Authorization?    → 401
    │  bad Bearer format?   → 401
    │  JWT verify fails?    → 401
    │  sub not numeric?     → 401
    │  user not in DB?      → 401
    │  user.isActive=false? → 401
    │  ✓ set request.user   → continue
    ▼
RolesGuard
    │  no @Roles decorator? → pass through
    │  user lacks role?     → 403 Insufficient role
    │  ✓                    → continue
    ▼
PermissionsGuard
    │  no @Permissions?     → pass through
    │  user lacks perm?     → 403 Insufficient permissions
    │  ✓                    → continue
    ▼
Route Handler
```

---

## 5. Adding New Roles and Permissions

### Add a permission

Insert a row into the `permissions` table:

```sql
INSERT INTO permissions (resource, action, name)
VALUES ('enrollment', 'export', 'enrollment:export');
```

### Create a role

```sql
INSERT INTO roles (role_name, description)
VALUES ('auditor', 'Read-only access to all enrollment records');
```

### Assign permissions to a role

```sql
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_name = 'auditor'
  AND p.name IN ('enrollment:read', 'enrollment:export');
```

### Assign a role to a user

```sql
INSERT INTO user_roles (user_id, role_id)
SELECT u.user_id, r.role_id
FROM users u, roles r
WHERE u.sso_user_id = 12345
  AND r.role_name = 'auditor';
```

### Protect a new endpoint

```typescript
@Get('export')
@Roles('admin', 'auditor')
@Permissions('enrollment:export')
export() { ... }
```

Role and permission changes in the database take up to **30 seconds** to reflect for users who are currently authenticated (due to the in-memory user cache in `JwtAuthGuard`).

---

## 6. Common Pitfalls

**Missing `@Permissions` on a mutation endpoint**
`@Roles` alone is an OR check — any user with that role passes. Always pair mutations with `@Permissions` so that fine-grained permission assignment works as intended.

**Adding `@Public()` to a controller class**
This marks every route in the controller as public. `request.user` will be `undefined` on all of them. Any handler that calls `@CurrentUser()` without a null guard will throw a `TypeError` at runtime.

**Expecting role/permission changes to be immediate**
The user cache has a 30-second TTL. If you deactivate a user or revoke a role and need immediate effect, you have two options:
- Set `cacheTtlMs` to `0` in `JwtAuthGuard` (removes caching, adds a DB query per request).
- Call `this.userCache.delete(ssoUserId)` from a service after mutating the user's roles.

**`ssoUserId` type**
The `users` table stores `sso_user_id` as a PostgreSQL `INTEGER` (32-bit, max ~2.1 billion). The SSO provider's user IDs must fit within this range. If your provider uses 64-bit IDs, migrate the column to `BIGINT` and update `SafeUser.ssoUserId` and `CreateUserDto.ssoUserId` to `bigint` / `string` accordingly.

**Circular module imports**
`AuthModule` imports `PrismaModule`. `UsersModule` imports both `PrismaModule` and `AuthModule`. Do not have `AuthModule` import `UsersModule` — this creates a circular dependency.
