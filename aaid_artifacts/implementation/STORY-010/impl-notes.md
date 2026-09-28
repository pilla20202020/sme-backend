# STORY-010 — Customer record management & search

**Service:** backend (uw-backend) · **Mode:** production

## Source files

- `prisma/schema.prisma` — added `Customer` model (indexed on `tenantId` and `phone`; no uniqueness constraint on name/phone/email — duplicates allowed by design); back-relation on `Tenant` (`customers`)
- `prisma/migrations/20260908090000_add_customers_suppliers/migration.sql` — hand-written migration for the `customers` and `suppliers` tables (both STORY-010 and STORY-011 schema in one migration, since they were designed together per the PRD), applied via `prisma migrate deploy`
- `prisma/seed.ts` — added `customer:create`/`customer:read` (and `supplier:create`/`supplier:read`, see STORY-011) permissions, granted to `owner` and `manager` (not `admin`'s explicit list — admin already gets everything via the existing grant-all loop)
- `src/customers/customers.module.ts` — registers `CustomersController`/`CustomersService`
- `src/customers/customers.controller.ts`, `src/customers/customers.service.ts`, `src/customers/customers.interface.ts`
- `src/customers/dto/create-customer.dto.ts`, `src/customers/dto/list-customers-query.dto.ts`
- `src/app.module.ts` — registered `CustomersModule` (and `SuppliersModule`, see STORY-011)

## Test files

- `src/customers/customers.service.spec.ts` — mocked-Prisma unit tests
- `src/customers/customers.controller.spec.ts` — real guard-integration tests (`JwtAuthGuard`/`RolesGuard`/`PermissionsGuard`/`TenantScopeGuard` wired as `APP_GUARD`s, driven through `supertest`)
- `src/customers/dto/create-customer.dto.spec.ts`

## Implementation notes

**Nesting and scoping.** Routes follow the exact `BranchesController`/`CategoriesController` pattern: `/tenants/:tenantId/customers`, relying on the global `TenantScopeGuard` for cross-tenant access denial and `CustomersService`'s own `tenantId`-filtered queries — the PRD explicitly warns not to rely on the guard alone.

**No uniqueness constraint anywhere, deliberately.** Unlike `CategoriesService`'s name-uniqueness dance, `CustomersService.create()` does no pre-check and no `P2002` handling at all — there is genuinely nothing to catch, since `Customer` declares no `@@unique` beyond its own primary key. The PRD is explicit that the same customer might legitimately be entered twice by different cashiers before anyone notices, and dedup tooling is out of scope for MVP. Tested explicitly in `customers.service.spec.ts` (`does not enforce any uniqueness on phone/email/name` — two identical creates both succeed).

**Search implementation.** `GET /customers?search=` needed its own query DTO for the same reason `ListProductsQueryDto` was introduced in STORY-006: Nest's `@Query()` binds the whole query string to one DTO, so `search` had to be declared on `ListCustomersQueryDto extends PaginationQueryDto` rather than as a sibling `@Query('search')` parameter, or the global `ValidationPipe`'s `forbidNonWhitelisted` would reject the request. The service builds a Prisma `OR: [{ name: contains, mode: insensitive }, { phone: contains, mode: insensitive }]` filter only when `search` is present and truthy; when absent, `where` degrades to the bare `{ tenantId }` filter, returning everything (paginated) — matching `findAllByTenant`'s existing no-filter behavior elsewhere in this codebase, per the PRD's explicit instruction.

**Empty-search-result is a 200, not a 404.** `findAll()` never throws for zero matches — it's a list endpoint, and Prisma naturally returns `[]`/`count: 0` for a filter that matches nothing. Verified in both the unit test (`returns an empty list (not an error) when no customer matches the search`) and the live smoke test (`GET .../customers?search=NOBODY` returned `200` with `{"data":[],"meta":{"total":0,...}}`).

**Response shape mirrors `CategoryResponse`/`BranchResponse`** — a plain flat object plus the shared `PaginatedResult<T>` wrapper, mapped through `formatDateMDY(..., { includeTime: true })` for `createdAt`/`updatedAt`, consistent with every other tenant-scoped resource in this codebase.

## Acceptance criteria status

- [x] AC-1: satisfied — a customer created with a given phone number is found when searched by that phone, exact or partial (case-insensitive `contains`). Verified in `customers.service.spec.ts` (`filters by name OR phone...`) and live: `POST` a customer with phone `555-0101`, then `GET .../customers?search=555-0101` returned it (and a second customer sharing the same phone, confirming multi-match handling).
- [x] AC-2: satisfied — a search with no match returns an empty list with `200`, never `404`. Verified in `customers.service.spec.ts` and live (`GET .../customers?search=NOBODY` → `200`, `{"data":[]}`).

No judgment calls needed beyond following the STORY-006 `ListProductsQueryDto` precedent for the `search` param — the PRD's contract here was unambiguous.
