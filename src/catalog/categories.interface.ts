export interface CategoryResponse {
  categoryId: number;
  tenantId: number;
  name: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
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
