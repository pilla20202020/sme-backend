# RBAC (Role-Based Access Control)

How roles and permissions work in `uw-backend`. Read this before adding a new endpoint that requires authorization, or before modifying roles in the database.

**See also:** [auth.md](./auth.md) for SSO authentication, cookie session management, and the JWT guard.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Permission Naming Convention](#2-permission-naming-convention)
3. [Guard Execution Order](#3-guard-execution-order)
4. [RolesGuard](#4-rolesguard)
5. [PermissionsGuard](#5-permissionsguard)
6. [Using Both Guards Together](#6-using-both-guards-together)
7. [Decorators Reference](#7-decorators-reference)
8. [Request Lifecycle](#8-request-lifecycle)
9. [Adding New Roles and Permissions](#9-adding-new-roles-and-permissions)
10. [Common Pitfalls](#10-common-pitfalls)

---

## 1. Database Schema

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

A user's effective permissions are the **union** of all permissions across all their roles. Duplicate permissions from multiple roles are automatically deduplicated when `authService.resolveUser()` builds the permissions array.

---

## 2. Permission Naming Convention

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

The `name` column in the `permissions` table holds this string and has a `UNIQUE` constraint. Use this string in `@Permissions(...)` decorators in code.

---

## 3. Guard Execution Order

All four guards are registered globally in `AppModule` as `APP_GUARD` providers:

```typescript
// app.module.ts
{ provide: APP_GUARD, useClass: ThrottlerGuard },     // 1st — rate limiting
{ provide: APP_GUARD, useClass: JwtAuthGuard },        // 2nd — identity & cookie
{ provide: APP_GUARD, useClass: RolesGuard },          // 3rd — role check
{ provide: APP_GUARD, useClass: PermissionsGuard },    // 4th — permission check
```

NestJS executes `APP_GUARD` providers in declaration order. A request must pass all four to reach the handler. If any guard throws, subsequent guards do not run.

---

## 4. RolesGuard

**File:** `src/auth/guards/roles.guard.ts`

Reads the `roles` metadata set by `@Roles(...)` and checks whether `request.user.roles` contains **any** of the required roles (OR logic).

```typescript
const hasRole = user.roles.some(role => requiredRoles.includes(role));
```

If no `@Roles(...)` decorator is present on the route or controller, the guard passes through (`return true`).

---

## 5. PermissionsGuard

**File:** `src/auth/guards/permissions.guard.ts`

Reads the `permissions` metadata set by `@Permissions(...)` and checks whether `request.user.permissions` contains **all** of the required permissions (AND logic).

```typescript
const hasAllPermissions = requiredPermissions.every(perm => user.permissions.includes(perm));
```

If no `@Permissions(...)` decorator is present, the guard passes through.

---

## 6. Using Both Guards Together

When both `@Roles` and `@Permissions` are applied to the same endpoint, **both** checks must pass independently:

```typescript
@Post()
@Roles('admin')
@Permissions('user:create')
create(@Body() dto: CreateUserDto) { ... }
```

The caller must have **both**:
- The `admin` role
- The `user:create` permission

Always apply `@Permissions` alongside `@Roles` for endpoints that mutate data. Relying solely on `@Roles` means any user with that role passes, regardless of their specific permission set.

---

## 7. Decorators Reference

All auth decorators are exported from `src/auth/decorators/index.ts`.

### `@Public()`

**File:** `src/auth/public.decorator.ts`

Marks a route as unauthenticated. `JwtAuthGuard` skips cookie verification entirely. `RolesGuard` and `PermissionsGuard` pass through because `request.user` is not set.

```typescript
import { Public } from '../auth/public.decorator';

@Get('ping')
@Public()
ping() { return 'pong'; }
```

### `@Roles(...roles)`

**File:** `src/auth/decorators/roles.decorator.ts`

Restricts a route to users who have **at least one** of the listed roles (OR).

```typescript
import { Roles } from '../auth/decorators';

@Get()
@Roles('admin', 'underwriter')
listEnrollments() { ... }
```

### `@Permissions(...permissions)`

**File:** `src/auth/decorators/permissions.decorator.ts`

Restricts a route to users who have **all** of the listed permissions (AND).

```typescript
import { Permissions } from '../auth/decorators';

@Patch(':id/approve')
@Permissions('enrollment:approve')
approve(@Param('id') id: string) { ... }
```

### `@CurrentUser()`

**File:** `src/auth/decorators/current-user.decorator.ts`

Parameter decorator that injects `request.user` as `AuthenticatedUser`. Use this instead of `@Req()` when you need the authenticated user in a handler.

```typescript
import { CurrentUser } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';

@Get('profile')
getProfile(@CurrentUser() user: AuthenticatedUser) {
  return { userId: user.userId, roles: user.roles };
}
```

---

## 8. Request Lifecycle

The full path from an incoming HTTP request to the handler:

```
HTTP Request
    │
    ▼
ThrottlerGuard
    │  fail → 429 Too Many Requests
    ▼
JwtAuthGuard
    │  @Public()?               → skip to RolesGuard (request.user not set)
    │  no uw_access_token?      → 401
    │  JWT verify fails?        → 401
    │  sub not integer?         → 401
    │  token expired?           → 401
    │  user not in DB?          → 401
    │  user.isActive = false?   → 401
    │  ✓ set request.user       → continue
    ▼
RolesGuard
    │  no @Roles decorator?     → pass through
    │  user lacks role?         → 403 Insufficient role
    │  ✓                        → continue
    ▼
PermissionsGuard
    │  no @Permissions?         → pass through
    │  user lacks permission?   → 403 Insufficient permissions
    │  ✓                        → continue
    ▼
Route Handler
```

---

## 9. Adding New Roles and Permissions

### Add a permission

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

### Cache propagation delay

Role and permission changes in the database take up to **30 seconds** to reflect for users who are currently authenticated, due to the in-memory user cache in `JwtAuthGuard`. This is per-user and per-instance — in a multi-instance deployment, the cache on each instance expires independently.

---

## 10. Common Pitfalls

**Missing `@Permissions` on a mutation endpoint**
`@Roles` alone is an OR check — any user with that role passes. Always pair mutations with `@Permissions` so that fine-grained permission assignment works as intended.

**Adding `@Public()` to a controller class**
This marks every route in the controller as public. `request.user` will be `undefined` on all of them. Any handler that uses `@CurrentUser()` without a null check will throw a `TypeError` at runtime.

**Expecting role/permission changes to be immediate**
The user cache has a 30-second TTL. If you deactivate a user or revoke a role and need immediate effect, reduce `cacheTtlMs` in `JwtAuthGuard` (at the cost of a DB query per request).

**Permissions are additive, not restrictive**
A user with two roles gets the union of both roles' permissions. There is no "deny" concept — you cannot take away a permission by assigning a second role. If you need permission restriction, do it through role assignment, not permission layering.

**`@Roles` uses OR, `@Permissions` uses AND**
`@Roles('admin', 'viewer')` passes if the user has *either* role. `@Permissions('enrollment:read', 'enrollment:approve')` requires the user to have *both* permissions. Mixing them up leads to either over-permissive or over-restrictive endpoints.
