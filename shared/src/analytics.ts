export interface Purchase {
  id: string;
  number: string;
  title: string;
  product: string | null;
  code: string | null;
  characteristics: string | null;
  comparisonGroup: string | null;
  date: string | null;
  region: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
  amountVat?: string;
  currency: string | null;
  vat: string | null;
  priceKind: string | null;
  status: string | null;
  priceDerived: boolean;
  identityKind?: 'nomenclature';
  sourceIdentity?: string;
  source: { file: string; sheet: string; row: number; currencyBasis?: 'user-confirmed' };
}

export interface PurchaseImportReport {
  sheets: { name: string; rows: number; headers: string[] }[];
  sheet: string;
  columns: { header: string; field: string | null; types: string[] }[];
  sample: Record<string, string>[];
  totalRows: number;
  validRows: number;
  skippedRows: number;
  duplicates: number;
  issues: { row: number; message: string }[];
  issueCount: number;
  fields: string[];
  imported: boolean;
  inserted?: number;
}

export interface PriceAggregate {
  price: number | null;
  count: number;
  volume: number | null;
  method: 'weighted' | 'arithmetic' | null;
}

export interface PriceBucket {
  from: string;
  to: string;
  main: PriceAggregate;
  comparison: PriceAggregate | null;
}

export interface PurchaseOptions {
  total: number;
  products: string[];
  regions: string[];
  statuses: string[];
  fields: string[];
  dated: number;
  productsTruncated?: boolean;
}

export interface PurchaseAnalytics {
  items: Purchase[];
  total: number;
  page: number;
  pageSize: number;
  selected: Purchase | null;
  main: PriceAggregate;
  /** True only when the selected purchase is the sole price in the main average. */
  mainIncludesSelected: boolean;
  comparison: PriceAggregate | null;
  difference: number | null;
  reason: string | null;
  period: { from: string | null; to: string; grouping: 'day' | 'week' | 'month' };
  buckets: PriceBucket[];
  undated: number;
}

export interface PurchaseReadiness {
  generatedAt: string;
  totalRows: number;
  eligibleRows: number;
  rowsWithAnalogs: number;
  comparableGroups: number;
  singleDocumentGroups: number;
  missingDateRows: number;
  missingPriceRows: number;
  periodRows: number;
  completeChartRows: number;
  completeChartGroups: number;
  expectedIntervals: number;
  period: { from: string; to: string; grouping: 'month' };
}
