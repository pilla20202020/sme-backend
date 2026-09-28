import { Vertical } from '@prisma/client';

export interface TenantResponse {
  tenantId: number;
  name: string;
  vertical: Vertical;
  currency: string;
  batchExpiryTrackingEnabled: boolean;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}
