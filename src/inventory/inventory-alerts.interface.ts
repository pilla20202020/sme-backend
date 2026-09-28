export interface LowStockAlertEntry {
  productId: number;
  name: string;
  sku: string | null;
  reorderThreshold: number;
  totalOnHand: number;
}

export interface NearExpiryAlertEntry {
  batchId: number;
  productId: number;
  productName: string;
  batchNumber: string;
  expiryDate: string | null;
  quantityRemaining: number;
  daysUntilExpiry: number;
}
