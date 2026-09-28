import { PurchaseOrderStatus } from '@prisma/client';

export interface PurchaseOrderLineResponse {
  lineId: number;
  purchaseOrderId: number;
  productId: number;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PurchaseOrderResponse {
  purchaseOrderId: number;
  tenantId: number;
  supplierId: number;
  status: PurchaseOrderStatus;
  orderDate: string | null;
  expectedDeliveryDate: string | null;
  notes: string | null;
  createdBy: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  lines: PurchaseOrderLineResponse[];
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
