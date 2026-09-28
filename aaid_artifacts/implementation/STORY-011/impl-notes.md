# STORY-011 — Supplier record management

**Service:** backend (uw-backend) · **Mode:** production

## Source files

- `prisma/schema.prisma` — added `Supplier` model (contact person, phone, email, payment terms, address — all the fields Purchasing's future PO needs for full traceability); back-relation on `Tenant` (`suppliers`)
- `prisma/migrations/20260908090000_add_customers_suppliers/migration.sql` — hand-written migration for the `customers` and `suppliers` tables (both STORY-010 and STORY-011 schema in one migration, since they were designed together per the PRD), applied via `prisma migrate deploy`
- `prisma/seed.ts` — added `supplier:create`/`supplier:read` (and `customer:create`/`customer:read`, see STORY-010) permissions, granted to `owner` and `manager`
- `src/suppliers/suppliers.module.ts` — registers `SuppliersController`/`SuppliersService`
- `src/suppliers/suppliers.controller.ts`, `src/suppliers/suppliers.service.ts`, `src/suppliers/suppliers.interface.ts`
- `src/suppliers/dto/create-supplier.dto.ts`
- `src/app.module.ts` — registered `SuppliersModule` (and `CustomersModule`, see STORY-010)

## Test files

- `src/suppliers/suppliers.service.spec.ts` — mocked-Prisma unit tests
- `src/suppliers/suppliers.controller.spec.ts` — real guard-integration tests (`JwtAuthGuard`/`RolesGuard`/`PermissionsGuard`/`TenantScopeGuard` wired as `APP_GUARD`s via `supertest`), plus a second describe block wiring the *real* `SuppliersService` against a fake `PrismaService` to assert tenant isolation over HTTP (mirrors `BranchesController`'s spec structure exactly: tenant 1 can fetch its own supplier by ID; tenant 1 cannot fetch tenant 2's supplier by ID and vice versa, both 404)
- `src/suppliers/dto/create-supplier.dto.spec.ts`

## Implementation notes

**Route shape mirrors `BranchesController` exactly** (the PRD's own comparison point) — `POST /tenants/:tenantId/suppliers`, `GET /tenants/:tenantId/suppliers/:supplierId`, `GET /tenants/:tenantId/suppliers`, all `@Permissions`-gated and relying on the global `TenantScopeGuard` plus `SuppliersService`'s own `findFirst({ where: { supplierId, tenantId } })` for the by-ID lookup, so a supplier is only ever findable through its own tenant.

**No cross-epic wiring.** Per the task's explicit constraint, this story does not touch Purchasing (EPIC-004) — it only makes sure the supplier record itself exists and is retrievable with every field a future PO will need (`contactPerson`, `phone`, `email`, `paymentTerms`, `address`). AC-1 is explicitly a "nothing to test cross-epic yet" acceptance criterion per the PRD, so verification here is limited to: the record can be created with all of those fields populated, and it comes back intact via both the by-ID and list endpoints.

**`paymentTerms` stays free text**, per the PRD (`"Net 30"`, `"COD"`, `"50% advance"` are all valid, unparsed strings) — no enum, no structured schema. `CreateSupplierDto` just treats it like any other optional trimmed string field.

**Response shape mirrors `BranchResponse`/`SupplierResponse`** — a flat object plus the shared `PaginatedResult<T>` wrapper, `createdAt`/`updatedAt` through `formatDateMDY(..., { includeTime: true })`.

## Acceptance criteria status

- [x] AC-1: satisfied — a supplier created with `contactPerson`, `phone`, `email`, `paymentTerms`, and `address` is retrievable in full via both `GET /suppliers/:supplierId` and `GET /suppliers` (list), giving Purchasing (a later epic) everything it needs to attach full supplier detail to a future PO. Verified in `suppliers.service.spec.ts` (`creates a supplier scoped to the given tenant with full contact details`) and live: `POST` with all fields populated, then both `GET .../suppliers/1` and `GET .../suppliers` returned the same complete record (including `paymentTerms: "Net 30"`). There is nothing to test cross-epic yet, per the PRD's own note on this AC — Purchasing's actual PO-attachment behavior is out of scope here.

No judgment calls needed — the PRD's API contract and data model for suppliers were unambiguous and directly modeled on the existing `BranchesController`/`BranchesService` pattern.
