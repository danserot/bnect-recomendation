export interface Region {
  id: string;
  name: string;
  aliases: string[];
}
export interface Tender {
  id: string;
  externalNumber: string;
  title: string;
  regionId: string | null;
  createdAt: string;
  industryGroup: string;
  activity: string;
  procurementMethod: string;
  procurementType: string;
  description?: string;
  status?: 'open' | 'closed';
  applicationDeadline?: string;
  source: 'import' | 'demo';
}
export interface SupplierProfile {
  id: string;
  name: string;
  specializationDescription: string;
  industryGroups: string[];
  activities: string[];
  serviceRegionIds: string[];
  procurementTypes: string[];
}
export interface RecommendationFilters {
  regionMode: 'supplier' | 'selected' | 'all';
  selectedRegionIds: string[];
  industryGroups?: string[];
  procurementTypes?: string[];
  procurementMethods?: string[];
  applySupplierIndustryGroups?: boolean;
  applySupplierProcurementTypes?: boolean;
  onlyOpen?: boolean;
}
export interface RecommendationRequest {
  profile: SupplierProfile;
  filters: RecommendationFilters;
}
export interface ResolvedFilters extends RecommendationFilters {
  regionIds: string[];
  regionNames: string[];
}
export interface RecommendationExplanation {
  querySource: 'profile' | 'tender';
  matchedFields: string[];
  regionalFilter: string;
  specialization: string;
  availability: string;
  rankingReason: string;
}
export interface Recommendation {
  tender: Tender;
  similarity: number;
  explanation: RecommendationExplanation;
}
export interface QueryInfo {
  source: 'profile' | 'tender';
  text: string;
  modelId: string;
  dimensions: number;
  tenderId?: string;
}
export interface RecommendationResponse {
  results: Recommendation[];
  candidateCount: number;
  totalCount: number;
  query: QueryInfo;
  filters: ResolvedFilters;
  demoNow: string;
}
export interface Catalog {
  regions: Region[];
  industryGroups: string[];
  activities: string[];
  procurementTypes: string[];
  procurementMethods: string[];
  demoNow: string;
  model: { id: string; dimensions: number; embeddingVersion: string };
}
export interface TenderListResponse {
  items: Tender[];
  total: number;
  page: number;
  pageSize: number;
}
export interface VectorPoint {
  tender: Tender;
  x: number;
  y: number;
  eligible: boolean;
  recommended: boolean;
}
export interface VectorSpaceResponse {
  points: VectorPoint[];
  query: { x: number; y: number; source: 'profile' | 'tender' };
  explainedVariance: [number, number];
  recommendations: RecommendationResponse;
  fingerprint: string;
}
export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
