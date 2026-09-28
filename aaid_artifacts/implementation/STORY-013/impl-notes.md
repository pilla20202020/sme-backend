# STORY-013 — Purchase order status tracking

**Service:** backend (uw-backend) · **Mode:** production

## Source files

No dedicated new files — this story is entirely the `computeStatus()` logic inside `src/purchasing/stock-receipts.service.ts` (built together with STORY-014, since status recomputation only ever happens as part of receiving) plus the `PurchaseOrderStatus` enum and `status` column already added to `PurchaseOrder` in STORY-012's schema edit. See STORY-012's impl-notes for the schema/migration/seed file list (shared) and STORY-014's impl-notes for the receiving service itself.

- `src/purchasing/stock-receipts.service.ts` — `computeStatus()` (module-level function)

## Test files

- `src/purchasing/stock-receipts.service.spec.ts` — covers all three status outcomes (`pending` never exercised directly here since a PO starts `pending` at creation and this service only ever moves it forward, but `partially_received` and `received` are both directly asserted, including the "still received despite an over-receipt" edge case)
- `src/purchasing/stock-receipt-partial-receiving.spec.ts` — real-DB test proving status is recomputed fresh across two separate receipt events, not just derived from the latest one

## Implementation notes

**Status is computed, never accepted as input, anywhere.** Neither `CreatePurchaseOrderDto` nor `CreateStockReceiptDto` (nor any receipt line DTO) declares a `status` field — the global `ValidationPipe`'s `forbidNonWhitelisted` would reject a request body containing one, and even if it didn't, no service code ever reads a caller-supplied status value. The only place `PurchaseOrder.status` is ever written is inside `StockReceiptsService.createReceipt()`'s transaction, via `computeStatus()`'s own return value.

**`computeStatus()` reads cumulative totals across every line, not just the lines touched by the current receipt:**
```ts
function computeStatus(lines) {
  const allReceived = lines.every((l) => l.quantityReceived >= l.quantityOrdered);
  if (allReceived) return 'received';
  const anyReceived = lines.some((l) => l.quantityReceived > 0);
  return anyReceived ? 'partially_received' : 'pending';
}
```
This matters for a multi-line PO where one receipt only touches some of its lines — a line nobody has received anything against yet still correctly holds the PO at `partially_received` (not `received`) until every line clears its own `quantityOrdered`. The function is called with a *fresh* `tx.purchaseOrderLine.findMany({ where: { purchaseOrderId } })` read taken **after** all of the current receipt's `increment` updates have been applied inside the same transaction — so it always reflects the true cumulative state, never a stale pre-receipt snapshot.

**An over-received line still counts as satisfied**, per the PRD's literal wording (`quantityReceived >= quantityOrdered`, not `===`) — a PO where every line has been received in full or in excess is `received`, not stuck in some undefined fourth state. Covered by a dedicated test (`flags an over-receipt as a discrepancy but still succeeds`) asserting `purchaseOrderStatus` is `'received'` even though one line's cumulative total (15) exceeds its `quantityOrdered` (10).

## Acceptance criteria status

- [x] AC-1: satisfied — a two-line PO with one line fully received and the other not yet reports `partially_received`. Directly exercised by `computeStatus()`'s `anyReceived`/`allReceived` logic (verified in `stock-receipts.service.spec.ts`); the live smoke test additionally confirmed the single-line partial case (60 of 100 received → `partially_received`).
- [x] AC-2: satisfied — every line's `quantityReceived >= quantityOrdered` yields `received`. Verified in `stock-receipts.service.spec.ts` (including the over-receipt edge case) and live: after the second smoke-test receipt brought the line's cumulative total to exactly 100 of 100 ordered, `GET /purchase-orders/7` returned `"status":"received"`.

No judgment calls needed — the PRD's three-state status rule was unambiguous and mapped directly onto a pure function over the line totals.
