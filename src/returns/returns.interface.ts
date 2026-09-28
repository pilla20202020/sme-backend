export interface ReturnLineResponseEntry {
  returnLineId: number;
  productId: number;
  productName: string;
  saleLineBatchAllocationId: number | null;
  productBatchId: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ReturnResponse {
  returnId: number;
  tenantId: number;
  saleId: number | null;
  reason: string;
  overrideApprovedBy: number | null;
  processedBy: number | null;
  refundTotal: number;
  returnDate: string | null;
  lines: ReturnLineResponseEntry[];
}
