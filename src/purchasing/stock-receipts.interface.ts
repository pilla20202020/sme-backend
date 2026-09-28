import { PurchaseOrderStatus } from '@prisma/client';

export interface StockReceiptLineResponse {
  receiptLineId: number;
  receiptId: number;
  purchaseOrderLineId: number;
  productId: number;
  quantityReceived: number;
  batchNumber: string;
  expiryDate: string | null;
  unitCost: number;
  productBatchId: number | null;
  createdAt: string | null;
}

export interface StockReceiptResponse {
  receiptId: number;
  tenantId: number;
  purchaseOrderId: number;
  receivedAt: string | null;
  receivedBy: number | null;
  notes: string | null;
  createdAt: string | null;
  lines: StockReceiptLineResponse[];
}

/**
 * A single line's mismatch between what this receipt event delivered and
 * what was still outstanding against the PO line at the moment this receipt
 * was processed. Recorded whenever quantityReceivedThisReceipt !==
 * outstandingBeforeReceipt (covers both under- and over-receipt) — per PRD
 * FR-10 AC-1, this is a flag on an otherwise-successful receipt, never a
 * rejection.
 */
export interface DiscrepancyEntry {
  purchaseOrderLineId: number;
  productId: number;
  quantityOrdered: number;
  outstandingBeforeReceipt: number;
  quantityReceivedThisReceipt: number;
}

export interface StockReceiptCreateResponse extends StockReceiptResponse {
  discrepancies: DiscrepancyEntry[];
  purchaseOrderStatus: PurchaseOrderStatus;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
}
