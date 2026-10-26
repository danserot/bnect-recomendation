export interface TenderImportError {
  row: number;
  field: string;
  message: string;
}

export interface TenderImportStatus {
  stage: 'waiting' | 'checking' | 'importing' | 'indexing' | 'ready' | 'error';
  message: string;
  rows?: number;
  imported?: number;
  errors?: TenderImportError[];
  updatedAt?: string;
}
