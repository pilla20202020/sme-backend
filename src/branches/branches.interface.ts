export interface BranchResponse {
  branchId: number;
  tenantId: number;
  name: string;
  address: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}
