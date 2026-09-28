# STORY-008 — Batch/lot & expiry tracking

**Service:** backend (uw-backend) · **Mode:** production

## Source files

- `prisma/schema.prisma` — added `ProductBatch` model (`expiryDate @db.Date` — the first pure-date, no-time field in this schema)
- `prisma/migrations/20260908080000_add_catalog/migration.sql` — includes `product_batches` table + indexes/FKs (shared migration with STORY-006/007/009, see STORY-006's notes)
- `src/catalog/product-batches.service.ts`
- `src/catalog/product-batches.controller.ts`
- `src/catalog/product-batches.interface.ts`
- `src/catalog/dto/create-batch.dto.ts`
- `src/catalog/catalog.module.ts` — registers `ProductBatchesController`/`ProductBatchesService`

## Test files

- `src/catalog/product-batches.service.spec.ts`
- `src/catalog/product-batches.controller.spec.ts` (real guard-integration tests)
- `src/catalog/dto/create-batch.dto.spec.ts`

## Implementation notes

**Past-expiry rejection compares calendar dates, not instants.** `startOfTodayUtc()` truncates "now" to midnight UTC before comparing against the batch's `expiryDate` (itself UTC-midnight, since `@db.Date` has no time component) — this guarantees a batch expiring "today" is never incorrectly rejected as "in the past" just because the request happened at, say, 11pm UTC. Comparing raw `Date.now()` against the parsed date instead would have made the edge case time-of-day-dependent, which is exactly the kind of subtle bug the PRD's "pharmacy regulation makes this a meaningful validation" framing warns against getting sloppy on.

**Ordering is `expiryDate asc` (soonest-first), not `createdAt`** — this is the literal AC-2 wording and also, per the PRD, deliberately sets up FEFO (earliest-expiry-first) for the later Sales/POS epic to consume; this story only orders the *read*, it implements no batch-selection logic itself (explicitly out of scope). Verified live: a far-expiry batch (2030) created before a near-expiry batch (2028) was still returned second — creation order does not leak into the response ordering.

**A product with zero batches is a valid, non-error state.** `findAllForProduct()` only 404s when the *product* doesn't belong to the tenant — an empty batch list for an otherwise-valid product returns `200` with `data: []`, `meta.total: 0`, matching the PRD's explicit callout that this must not error.

**No consumption/decrement logic was added**, per the PRD's explicit deferral: `quantityRemaining` is set equal to `quantityReceived` at creation and never modified anywhere in this story's code — Sales/POS (EPIC-006) and Inventory adjustments (EPIC-005) own that later. Similarly, no near-expiry alert query was added (EPIC-005-04's job) — `GET .../batches` only exposes `expiryDate` as raw, queryable data.

## Acceptance criteria status

- [x] AC-1: satisfied — a batch created with `batchNumber`/`expiryDate` gets its own `batchId`, independently retrievable via `GET .../batches`, with `quantityRemaining` equal to `quantityReceived` at creation; verified in `product-batches.service.spec.ts` and live (`quantityReceived: 50` → `quantityRemaining: 50` in the response).
- [x] AC-2: satisfied — multiple batches of the same product with different expiry dates are returned soonest-expiry-first; verified in `product-batches.service.spec.ts` (asserts `orderBy: { expiryDate: 'asc' }`) and live (a 2028-expiry batch was listed before a 2030-expiry batch, regardless of creation order).
- [x] AC-3: satisfied — an `expiryDate` in the past is rejected with 400 (`BadRequestException`), not silently accepted; verified in `product-batches.service.spec.ts` and live (`curl POST` with `expiryDate: "2020-01-01"` returned 400 and created no row).
