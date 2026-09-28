// ─── STORY-019 quote (read-only, no writes) ──────────────────────────────────

export interface QuoteLineResult {
  productId: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  available: boolean;
  totalOnHand: number;
}

export interface QuoteResponse {
  lines: QuoteLineResult[];
  subtotal: number;
  total: number;
  allSufficient: boolean;
}

// ─── STORY-020/022 checkout + get-sale + receipt (one shared shape) ──────────
// PRD §8: "the checkout response and the receipt response should be the same
// shape — implement one mapSaleReceipt() and reuse it in both places." The
// plain GET /sales/:saleId endpoint reuses it too (PRD §8's closing note).

// SPRINT-014 addition (returns UI backend dependency, PRD §2): a matched
// return needs to name the exact SaleLineBatchAllocation it's reversing, and
// until now nothing exposed a sale line's own id or its allocation(s)
// anywhere in this response — purely additive, no existing field removed or
// renamed, so checkout/receipt/sales-list consumers keep working unchanged.
export interface SaleLineAllocationEntry {
  saleLineBatchAllocationId: number;
  quantity: number;
}

export interface SaleLineReceiptEntry {
  saleLineId: number;
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  allocations: SaleLineAllocationEntry[];
}

export interface SaleCustomerSummary {
  customerId: number;
  name: string;
}

export interface SaleCashierSummary {
  userId: number;
  firstName: string;
  lastName: string;
}

export interface SaleReceiptResponse {
  saleId: number;
  saleDate: string | null;
  customer: SaleCustomerSummary | null;
  cashier: SaleCashierSummary | null;
  lines: SaleLineReceiptEntry[];
  subtotal: number;
  total: number;
}

// ─── STORY-028 sales list (paginated, dateFrom/dateTo filterable) ────────────

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
}
