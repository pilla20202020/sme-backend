export interface ImportRowFailure {
  row: number;
  errors: string[];
}

export interface ImportResult {
  created: number;
  updated: number;
  failed: ImportRowFailure[];
}
