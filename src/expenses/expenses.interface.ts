export interface ExpenseResponse {
  expenseId: number;
  tenantId: number;
  branchId: number;
  category: string;
  amount: number;
  description: string | null;
  expenseDate: string | null;
  recordedBy: number | null;
  createdAt: string | null;
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
