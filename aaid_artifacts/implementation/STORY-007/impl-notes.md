# STORY-007 — Pricing management with price history

**Service:** backend (uw-backend) · **Mode:** production

## Source files

- `prisma/schema.prisma` — added `ProductPriceHistory` model (append-only; `changedByUser` relation to `User`)
- `prisma/migrations/20260908080000_add_catalog/migration.sql` — includes `product_price_history` table + FKs (shared migration with STORY-006/008/009, see that story's notes)
- `src/catalog/products.service.ts` — `updatePrice()` and `getPriceHistory()`
- `src/catalog/products.controller.ts` — `PUT :productId/price` and `GET :productId/price-history`
- `src/catalog/products.interface.ts` — `ProductPriceHistoryResponse`
- `src/catalog/dto/update-price.dto.ts`
- `src/auth/decorators` (no change — reused `CurrentUser` to thread `changedBy`)

## Test files

- `src/catalog/products.service.spec.ts` (`updatePrice`, `getPriceHistory` describe blocks)
- `src/catalog/products.controller.spec.ts` (`PUT .../price`, `GET .../price-history` guard-integration tests)
- `src/catalog/dto/update-price.dto.spec.ts`

## Implementation notes

**Atomicity via `$transaction` array form, not the interactive/callback form.** `updatePrice()` needs to update `Product.currentPrice` and insert a `ProductPriceHistory` row that must never observably diverge. Both operations only need already-known inputs (`productId`, `price`) — neither depends on the other's result — so the array form (`this.prisma.$transaction([update, create])`) is sufficient and simpler to test than the interactive/callback form (which would need a mocked `tx` client in unit tests). Verified in `products.service.spec.ts` that both operations are dispatched through exactly one `$transaction` call.

**Initial product creation deliberately does NOT seed a `ProductPriceHistory` row.** `ProductsService.create()` sets `currentPrice` directly with no history insert — there is no prior price to "change from" at creation time, so a history row would be a synthetic historical record it isn't. The judgment call: STORY-007's ACs are both worded around *changes* ("a price change, when saved..."), so history starts recording from the first real `PUT .../price` call, not from creation. This does mean `GET .../price-history` can return zero rows for a brand-new product that has never had its price explicitly changed since creation — treated as correct, not a gap, since AC-1/AC-2 only test the changed-price case (verified live: 3 sequential price changes on the same product produced exactly 3 history rows, most-recent-first).

**`changedBy` is threaded from the real session, not left as a TODO.** `ProductsController.updatePrice()` pulls `user.userId` via `@CurrentUser()` (already available from `AuthenticatedUser`/`ResolvedUser`, set by `JwtAuthGuard`) and passes it through as `changedBy`. When no user context exists (defensive fallback), the service stores `null` rather than throwing — this only matters for tests calling the service directly without a controller-supplied user. Verified live: the smoke test's `PUT .../price` call recorded `changedBy: 66` (the logged-in smoke-test owner's real `userId`), and the bulk-import path (STORY-009), which has no per-row user context, correctly stores `changedBy: null` for import-triggered price changes.

**Ordering is `effectiveFrom desc`, matching AC-2's literal wording** ("all 3 rows are returned ordered most-recent-first") — not `createdAt desc`, since `effectiveFrom` is the field that actually represents "when this price took effect," even though the two will be identical for the foreseeable future since nothing yet allows backdating a price change.

## Acceptance criteria status

- [x] AC-1: satisfied — `PUT .../price` updates `Product.currentPrice` and appends a new `ProductPriceHistory` row with the *new* price and a fresh `effectiveFrom`, in the same transaction; verified in `products.service.spec.ts` and live (price updated from 1.50 → 2.75 → 3.10 across two calls, `GET .../price-history` reflected each).
- [x] AC-2: satisfied — 3+ price changes on the same product return all rows via `GET .../price-history`, ordered most-recent-first (`effectiveFrom desc`); verified in `products.service.spec.ts` (`getPriceHistory` describe block) and live (2 sequential changes returned newest-first; a 3rd was exercised via the bulk-import path in the STORY-009 smoke test, also newest-first).
