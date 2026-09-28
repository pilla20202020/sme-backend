import { InventoryMovementType } from '@prisma/client';

export interface InventoryMovementResponse {
  movementId: string;
  tenantId: number;
  productId: number;
  productBatchId: number | null;
  movementType: InventoryMovementType;
  quantityDelta: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: number | null;
  actorId: number | null;
  occurredAt: string | null;
}

export interface OnHandBatchEntry {
  batchId: number;
  batchNumber: string;
  expiryDate: string | null;
  quantityRemaining: number;
}

export interface OnHandResponse {
  productId: number;
  totalOnHand: number;
  batches: OnHandBatchEntry[];
}

export interface InventoryAdjustmentResponse {
  movement: InventoryMovementResponse;
  quantityRemaining: number;
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
