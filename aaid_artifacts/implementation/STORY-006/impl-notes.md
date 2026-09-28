# STORY-006 — Product CRUD with category & unit

**Service:** backend (uw-backend) · **Mode:** production

## Source files

- `prisma/schema.prisma` — added `Category` model, `Product` model, `ProductUnit` enum; back-relations on `Tenant` (`categories`, `products`, `productBatches`) and `User` (`priceChangesMade`, used by STORY-007)
- `prisma/migrations/20260908080000_add_catalog/migration.sql` — hand-written migration for all four new catalog tables (`categories`, `products`, `product_price_history`, `product_batches`) and the `product_unit` enum, applied via `prisma migrate deploy` (see STORY-007/008/009 notes — one migration covers all four stories' schema since they were designed together per the PRD)
- `prisma/seed.ts` — added `catalog:create`/`catalog:read`/`catalog:update` permissions, granted to `owner` and `manager` (not `admin`'s explicit list — admin already gets everything via the existing grant-all loop)
- `src/catalog/catalog.module.ts` — registers all four catalog controllers/services (Categories, Products, ProductBatches, CatalogImport)
- `src/catalog/categories.controller.ts`, `src/catalog/categories.service.ts`, `src/catalog/categories.interface.ts`
- `src/catalog/products.controller.ts`, `src/catalog/products.service.ts`, `src/catalog/products.interface.ts`
- `src/catalog/dto/create-category.dto.ts`, `src/catalog/dto/create-product.dto.ts`, `src/catalog/dto/update-product.dto.ts`, `src/catalog/dto/list-products-query.dto.ts`
- `src/app.module.ts` — registered `CatalogModule`

## Test files

- `src/catalog/categories.service.spec.ts`, `src/catalog/categories.controller.spec.ts` (real guard-integration tests)
- `src/catalog/products.service.spec.ts`, `src/catalog/products.controller.spec.ts` (real guard-integration tests, including a real `ValidationPipe` to verify AC-3 at the HTTP layer)
- `src/catalog/dto/create-category.dto.spec.ts`, `src/catalog/dto/create-product.dto.spec.ts`, `src/catalog/dto/update-product.dto.spec.ts`

## Implementation notes

**Nesting and scoping.** Routes follow the exact `BranchesController` pattern: `/tenants/:tenantId/categories` and `/tenants/:tenantId/products`, relying on the global `TenantScopeGuard` for cross-tenant access denial and each service's own `findFirst({ where: { id, tenantId } })` queries for tenant-scoped reads/writes — the PRD explicitly warns not to rely on the guard alone, so every service method filters by `tenantId` itself.

**Category name uniqueness is enforced twice, deliberately.** Postgres unique constraints are case-sensitive, so `@@unique([tenantId, name])` alone would let "Tablets" and "tablets" coexist. `CategoriesService.create()` first does an application-layer case-insensitive `findFirst` check (`mode: 'insensitive'`), then still catches a `P2002` from the DB constraint as a `ConflictException` — the first check handles the common case cleanly (nice error message), the second closes the genuine race-condition window between the check and the insert.

**`currentPrice` is fenced off from `UpdateProductDto` entirely, not just runtime-checked.** The DTO simply never declares the field. Combined with `main.ts`'s global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`, a `PATCH` body containing `currentPrice` is rejected with 400 before `ProductsController.update()` ever runs — verified for real in `products.controller.spec.ts` (not just asserted against the DTO shape), matching AC-3's literal wording.

**`categoryId` filtering on `GET /products` needed its own query DTO.** Nest's `@Query()` (no key) binds the *entire* query-string object to one DTO instance. A first attempt used a separate `@Query('categoryId')` parameter alongside `@Query() query: PaginationQueryDto` — but the global `ValidationPipe`'s `forbidNonWhitelisted` then rejected the whole request with 400, because `categoryId` isn't a field `PaginationQueryDto` declares (it doesn't know a sibling parameter is about to claim it). Fixed by introducing `ListProductsQueryDto extends PaginationQueryDto` with `categoryId` as its own optional field, so the one `@Query()` binding validates against a DTO that actually declares everything present. Caught live during the STORY-006/009 smoke test (curling `GET /products?categoryId=2` returned 400), not just in unit tests — worth flagging since it's an easy mistake to reintroduce on a future paginated+filtered list endpoint.

**sku uniqueness relies on the DB constraint, not a pre-check.** Unlike category names, sku conflicts are resolved purely via `@@unique([tenantId, sku])` + a `P2002` catch (no pre-`findFirst`) — a duplicate name needs a friendly message on the common path, but sku collisions are less latency-sensitive and the DB is the correct single source of truth for whether the very insert about to happen collides; skipping the extra round-trip is a minor efficiency choice, not a correctness gap (Postgres still enforces it exactly, and NULLs never collide, satisfying the PRD's per-tenant-nullable-sku rule).

## Acceptance criteria status

- [x] AC-1: satisfied — `POST /products` with `name`/`unit`/`currentPrice` creates a product immediately retrievable via `GET /products/:productId` and `GET /products`; verified in `products.service.spec.ts` and live in the STORY-006 smoke test (`curl POST` then `curl GET` returned the same record).
- [x] AC-2: satisfied — `PATCH` updates to `name` are visible on the very next `GET` (no caching layer exists anywhere in this stack); verified in `products.service.spec.ts` (`update` test) and live (`PATCH` then `GET` returned the new name).
- [x] AC-3: satisfied — a `PATCH` body containing `currentPrice` is rejected with 400 via `forbidNonWhitelisted`, and the product's price is unchanged; verified at the real HTTP layer in `products.controller.spec.ts` and live in the smoke test.
- [x] AC-4: satisfied — a duplicate `sku` within the same tenant is rejected with 409 (`P2002` → `ConflictException`); verified in `products.service.spec.ts` and live (`curl` returned 409 for a repeat sku).
- [x] AC-5: satisfied — `@@unique([tenantId, sku])` scopes the constraint per tenant (composite index on `(tenant_id, sku)`, not `sku` alone), so the same sku in a different tenant succeeds. Verified structurally (migration SQL + schema) and by the create-path logic never querying/constraining on `sku` without `tenantId`; the live smoke test registered a second tenant to confirm tenant creation itself works, but did not additionally re-post the same sku into it — that specific cross-tenant-sku-succeeds path is covered by the schema/constraint design rather than a second live curl call. Flagging this as a smoke-test gap rather than silently claiming full live coverage.
