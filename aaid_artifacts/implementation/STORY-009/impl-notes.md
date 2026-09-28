# STORY-009 — Bulk catalog import

**Service:** backend (uw-backend) · **Mode:** production

## Source files

- `src/catalog/catalog-import.service.ts`
- `src/catalog/catalog-import.controller.ts`
- `src/catalog/catalog-import.interface.ts` — `ImportResult`, `ImportRowFailure`
- `src/catalog/dto/import-product-row.dto.ts` — per-row validation shape, never bound directly to `@Body()`
- `src/catalog/categories.service.ts` — `findOrCreateByName()`, added specifically for this story's auto-create-category requirement, reused by nothing else
- `src/catalog/catalog.module.ts` — registers `CatalogImportController`/`CatalogImportService`

## Test files

- `src/catalog/catalog-import.service.spec.ts`
- `src/catalog/catalog-import.controller.spec.ts` (real guard-integration test)
- `src/catalog/dto/import-product-row.dto.spec.ts`
- `src/catalog/categories.service.spec.ts` (`findOrCreateByName` describe block)

## Implementation notes

**JSON array over CSV/multipart, per the PRD's own recommendation (OQ-C2).** No file-upload dependency exists in this codebase yet, and introducing one just for this story would be scope creep past what's needed; `POST .../products/import` accepts a raw JSON array in the request body.

**The controller's `@Body()` is typed `unknown`, not a DTO class — deliberately, to make "one bad row never aborts the rest" actually true.** If the array were bound to, say, `ImportProductRowDto[]` directly, Nest's global `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true`) would run class-validator against the *entire* array as one unit and reject the whole request with 400 the moment any single row fails — exactly the failure mode FR-06/AC-1 forbids. Typing the parameter `unknown` sidesteps this: Nest's `ValidationPipe.toValidate()` skips class-validator entirely for `Object`/`Array`-typed parameters, so the raw array reaches `CatalogImportService.importProducts()` untouched, and *that* method validates each row independently via `plainToInstance` + `validate()`, collecting per-row errors without ever throwing for the batch as a whole. Verified live: a payload with 3 good rows and 1 row with an empty `name` returned `{"created":2,"updated":1,"failed":[{"row":3,"errors":[...]}]}` — the response format the PRD specifies — not a 400 for the whole request.

**Create-vs-update semantics: matched by `sku`, not name.** A row with a `sku` matching an existing product in the tenant updates that product (counted as `updated`); every other row (no sku, or a sku with no match) creates a new product (counted as `created`). This was a judgment call the PRD's API contract section doesn't fully spell out (it only says the response has `created`/`updated`/`failed` counts, not what makes a row an update vs a create) — sku was the obvious natural key since it's the field the PRD calls out as the tenant-unique lookup elsewhere in the same document. Rows with no sku always create, since there's nothing reliable to match an existing product against (name isn't guaranteed unique).

**A price change during an sku-matched update is routed through the same transactional history-append as the dedicated pricing endpoint (STORY-007), not a bare field update.** `currentPrice` must never change anywhere in this system without a matching `ProductPriceHistory` row — bulk import is a second write path to the same field, so it has to honor the same invariant or STORY-007's guarantee becomes false the moment someone imports a price change instead of using `PUT .../price`. When the imported row's price matches the existing stored price, no transaction/history-row is created at all (nothing changed, nothing to log) — verified live: importing the same price for an existing sku left the price-history row count unchanged; importing a *different* price for that same sku added exactly one new history row with `changedBy: null` (import has no per-row user/session context to attribute the change to, unlike the dedicated pricing endpoint).

**`categoryName` auto-creation reuses `CategoriesService.findOrCreateByName()`**, which itself reuses the same case-insensitive lookup as `CategoriesService.create()` and falls back to the "race winner" on a concurrent-create `P2002` (two import rows in the same batch both introducing the same brand-new category name) — verified live: importing rows referencing `"Capsules"` and `"Syrups"` (neither pre-existing) created both categories automatically, confirmed via a follow-up `GET /categories`.

**Per-row processing errors (not just validation errors) are also caught and reported, never allowed to propagate.** The `try/catch` around each row's processing (category lookup, existing-product lookup, create/update) catches anything — a DB error, a constraint violation not otherwise anticipated — and records it as a row failure with the error's message, rather than letting one row's unexpected failure crash the whole import loop. Verified in `catalog-import.service.spec.ts` by forcing `prisma.product.create` to reject for one row among two and confirming the other row still succeeded.

## Acceptance criteria status

- [x] AC-1: satisfied — a bulk import with some invalid rows creates/updates every valid row and reports each invalid row individually with row number + reason; the import never aborts on one bad row. Verified in `catalog-import.service.spec.ts` (multiple scenarios) and live (3 good + 1 bad row → 2 created, 1 updated, 1 failure reported by row number and reason, in one request).
- [x] AC-2: satisfied — the response body is `{ created, updated, failed }`, summarizing exactly those counts; verified in every test in `catalog-import.service.spec.ts` and in every live `curl` call against the real endpoint.
- [x] AC-3: satisfied — a row referencing a `categoryName` that doesn't exist yet for the tenant gets that category auto-created rather than the row failing; verified in `catalog-import.service.spec.ts` and live (`"Capsules"`/`"Syrups"` categories did not exist before the import and were present in `GET /categories` immediately after).

## QA follow-up (post-review)

An independent senior-QA pass verdicted PASS-WITH-FINDINGS. One real bug, fixed:

- **`updateExistingProduct` unconditionally wrote `categoryId: categoryId ?? null` and `reorderThreshold: dto.reorderThreshold ?? null`** — since both are optional on `ImportProductRowDto`, any re-import row that simply omitted them (a very likely real-world case — a supplier price-list update that doesn't repeat every column) silently wiped an existing product's category and reorder threshold to `null`. Fixed to mirror `ProductsService.update()`'s `!== undefined` partial-update pattern — only fields the row actually specified are included in the update payload. Added both a regression test (omitted fields preserved) and a positive test (provided fields do update) to `catalog-import.service.spec.ts`.
- Also added, per the same review: an `assertTenantExists` check at the top of `importProducts` (previously a nonexistent tenant would fail every row individually with a raw Prisma FK-violation message instead of one clean 404 — a minor inconsistency with every other catalog service, not a security issue since `TenantScopeGuard` already blocks regular users from reaching this path for a tenant that isn't theirs).
- STORY-008's exact-today expiry boundary (accepted, per a strict `<` comparison) was implemented correctly but untested — added a boundary test to `product-batches.service.spec.ts` to lock in the existing, correct behavior.

## Judgment calls / open items for reviewer attention

- The PRD's API contract doesn't explicitly define create-vs-update matching semantics for bulk import — implemented as sku-match-updates, no-sku-always-creates (see notes above). Flagging in case product intent differs (e.g. matching by name+category instead).
- Bulk-import-triggered price changes record `changedBy: null` in `ProductPriceHistory` since there's no per-row actor to attribute to a JSON-array import (unlike the interactive `PUT .../price` endpoint, which has a real session). This is consistent with the schema's `changedBy Int?` being nullable specifically for cases like this, per the PRD's own note that it's "optional to populate ... don't block the story on it."
