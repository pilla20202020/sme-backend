import { ProductUnit } from '@prisma/client';

export interface ProductResponse {
  productId: number;
  tenantId: number;
  categoryId: number | null;
  name: string;
  sku: string | null;
  unit: ProductUnit;
  currentPrice: number;
  reorderThreshold: number | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProductPriceHistoryResponse {
  id: string;
  productId: number;
  price: number;
  effectiveFrom: string | null;
  changedBy: number | null;
  createdAt: string | null;
}
