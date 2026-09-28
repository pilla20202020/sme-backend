export interface DailyCashResponse {
  date: string;
  salesTotal: number;
  returnsTotal: number;
  expensesTotal: number;
  netCashPosition: number;
  saleCount: number;
  returnCount: number;
  expenseCount: number;
}
