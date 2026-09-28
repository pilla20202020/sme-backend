# STORY-012 — Purchase order creation

**Service:** backend (uw-backend) · **Mode:** production

## Source files

- `prisma/schema.prisma` — added `PurchaseOrderStatus` enum, `PurchaseOrder` model, `PurchaseOrderLine` model; back-relations on `Tenant` (`purchaseOrders`, `stockReceipts`), `Supplier` (`purchaseOrders`), `Product` (`purchaseOrderLines`, `stockReceiptLines`), `User` (`purchaseOrdersCreated`, `stockReceiptsReceived`), `ProductBatch` (`stockReceiptLines`) — the last three are shared with STORY-014's models, added in the same schema edit since all four new models were designed together per the PRD
- `prisma/migrations/20260908100000_add_purchasing/migration.sql` — hand-written migration for all four new purchasing tables (`purchase_orders`, `purchase_order_lines`, `stock_receipts`, `stock_receipt_lines`) and the `purchase_order_status` enum, applied via `prisma migrate deploy` (one migration covers STORY-012/013/014's schema, matching the established pattern from STORY-006..009's single catalog migration)
- `prisma/seed.ts` — added `purchasing:create`/`purchasing:read`/`purchasing:update` permissions, granted to `owner` and `manager`
- `src/purchasing/purchasing.module.ts` — registers `PurchaseOrdersController`/`Service` and `StockReceiptsController`/`Service` (STORY-014)
- `src/purchasing/purchase-orders.controller.ts`, `src/purchasing/purchase-orders.service.ts`, `src/purchasing/purchase-orders.interface.ts`
- `src/purchasing/dto/create-purchase-order.dto.ts`, `src/purchasing/dto/create-purchase-order-line.dto.ts`, `src/purchasing/dto/list-purchase-orders-query.dto.ts`
- `src/app.module.ts` — registered `PurchasingModule`

## Test files

- `src/purchasing/purchase-orders.service.spec.ts` — mocked-Prisma unit tests
- `src/purchasing/purchase-orders.controller.spec.ts` — real guard-integration tests (`JwtAuthGuard`/`RolesGuard`/`PermissionsGuard`/`TenantScopeGuard` wired as `APP_GUARD`s via `supertest`, plus a real `ValidationPipe` to verify the empty-`lines` 400 at the HTTP layer)
- `src/purchasing/purchase-order-price-freeze.spec.ts` — a real-DB integration test (mirrors `src/auth/rbac-enforcement.spec.ts`'s established pattern of testing against the actual local Postgres database rather than mocks) proving AC-2 end to end: create a PO line at `unitCost: 8.5`, call the real `ProductsService.updatePrice()` to change the product's `currentPrice` to `99.99`, then re-fetch the PO and confirm `unitCost` is still `8.5`

## Implementation notes

**Route shape mirrors `SuppliersController`/`ProductsController` exactly** — `POST /tenants/:tenantId/purchase-orders`, `GET /tenants/:tenantId/purchase-orders/:purchaseOrderId`, `GET /tenants/:tenantId/purchase-orders` (paginated, optional `status` filter via `ListPurchaseOrdersQueryDto extends PaginationQueryDto`), all `@Permissions`-gated and relying on the global `TenantScopeGuard` plus `PurchaseOrdersService`'s own `findFirst({ where: { id, tenantId } })` for the by-ID lookup.

**unitCost/productId freeze is structural, not a runtime check.** `PurchaseOrderLine.unitCost` is written once at `create()` time from the DTO and never touched again by any other code path in this story — there is no update endpoint for a PO's lines at all (PRD explicitly defers PO editing). `findById()`/`findAll()` map straight from the stored `PurchaseOrderLine` row; nothing ever joins to or reads `Product.currentPrice` when building a PO response. This is verified two ways: a mocked-Prisma test in `purchase-orders.service.spec.ts` asserting `product.findMany` (the only Product-touching call in this service) is never invoked by `findById()`, and — because a mock can only prove the code doesn't *read* the live price, not that the DB row is genuinely unaffected — a second, real-database test (`purchase-order-price-freeze.spec.ts`) that creates a real product, a real PO line referencing it, changes the product's real price via the real `ProductsService.updatePrice()`, and confirms the PO line is untouched.

**Empty-`lines` rejection (AC-3) is enforced by `CreatePurchaseOrderDto`'s `@ArrayMinSize(1)`, not a manual service-layer check** — consistent with how this codebase already relies on the global `ValidationPipe` (`forbidNonWhitelisted`, etc.) for shape-level input rules rather than duplicating them in the service. Verified at the real HTTP layer in `purchase-orders.controller.spec.ts` (mirrors `ProductsController.update`'s AC-3 verification style for `currentPrice`).

**Supplier/product tenant-ownership is checked before insert, not left to a DB constraint.** `assertSupplierBelongsToTenant` mirrors the existing `assertCategoryBelongsToTenant`/`assertProductExists` pattern exactly. `assertProductsBelongToTenant` batches all of a PO's line `productId`s into a single `findMany({ where: { productId: { in: [...] }, tenantId } })` rather than one query per line — a PO can carry many lines, and N+1 lookups here would scale badly; the missing-ID diagnostic (`Product(s) 3, 7 not found for tenant 1`) is built by diffing the requested set against what was actually found.

**Status is never caller-supplied on create.** `CreatePurchaseOrderDto` has no `status` field at all — a new PO is unconditionally `pending` (the Prisma column default), and every line starts at `quantityReceived: 0` (also a column default). The only code path that ever writes `PurchaseOrder.status` is `StockReceiptsService.createReceipt()` (STORY-013/014), which always computes it fresh from cumulative line totals.

## Acceptance criteria status

- [x] AC-1: satisfied — a PO created with a valid `supplierId` and at least one line exists in `pending` status with every line at `quantityReceived: 0`. Verified in `purchase-orders.service.spec.ts` and live (`curl POST` returned `"status":"pending"`, `"quantityReceived":0`).
- [x] AC-2: satisfied — a PO's line `unitCost` is completely unaffected by a later change to the referenced product's `currentPrice`. Verified in the real-DB test (`purchase-order-price-freeze.spec.ts`) and live: created a product at price 20, a PO line at `unitCost: 12.5`, changed the product's price to 999.99 via `PUT .../price`, then re-fetched the PO — `unitCost` was still `12.5`.
- [x] AC-3: satisfied — `POST` with an empty `lines` array is rejected with 400 before the service ever runs. Verified at the real HTTP layer in `purchase-orders.controller.spec.ts` and live (`curl` with `"lines":[]"` returned 400).

No judgment calls needed beyond what's noted above — the PRD's data model and API contract for PO creation were unambiguous.
