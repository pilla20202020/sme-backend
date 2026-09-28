export interface ProductBatchResponse {
  batchId: number;
  tenantId: number;
  productId: number;
  batchNumber: string;
  expiryDate: string | null;
  quantityReceived: number;
  quantityRemaining: number;
  receivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
