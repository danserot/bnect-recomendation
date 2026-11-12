export type BenchmarkCategory = 'synonym' | 'paraphrase' | 'abbreviation';

export interface BenchmarkCase {
  id: string;
  category: BenchmarkCategory;
  label: string;
  query: string;
  expectedId: string;
}

export interface BenchmarkDocument {
  id: string;
  text: string;
}

export interface BenchmarkDataset {
  version: string;
  description: string;
  cases: BenchmarkCase[];
  documents: BenchmarkDocument[];
}

export interface ModelInfo {
  id: string;
  revision: string;
  embeddingVersion: string;
  dimensions: number;
  state: 'not_loaded' | 'loading' | 'ready' | 'error';
  runtime: 'local' | 'docker';
  device: 'cpu';
  dtype: 'q8';
  batchSize: number;
  cacheDirectory: string;
  modelDirectory: string;
  files: { name: string; bytes: number }[];
  totalBytes: number;
  remoteDownloads: false;
  environment: {
    platform: string;
    architecture: string;
    cpu: string;
    logicalCores: number;
    memoryBytes: number;
    node: string;
  };
}

export interface BenchmarkCaseResult extends BenchmarkCase {
  expectedText: string;
  rank: number;
  similarity: number;
  queryMs: number;
  rankingMs: number;
  top: { id: string; text: string; similarity: number }[];
}

export interface BenchmarkAccuracy {
  count: number;
  top1: number;
  top3: number;
  mrr: number;
}

export interface ModelBenchmarkReport {
  id: string;
  datasetVersion: string;
  startedAt: string;
  completedAt: string;
  model: ModelInfo;
  documentCount: number;
  queryCount: number;
  timing: {
    totalMs: number;
    modelLoadMs: number;
    modelWasReady: boolean;
    warmupMs: number;
    documentEmbeddingMs: number;
    documentsPerSecond: number;
    queryMedianMs: number;
    queryP95Ms: number;
    queryMeanMs: number;
    queriesPerSecond: number;
    cachedQueryMedianMs: number;
    cachedQuerySamples: number;
  };
  accuracy: BenchmarkAccuracy;
  byCategory: Record<BenchmarkCategory, BenchmarkAccuracy>;
  cases: BenchmarkCaseResult[];
}

export interface ModelBenchmarkStatus {
  state: 'idle' | 'running' | 'completed' | 'error';
  phase: 'idle' | 'loading' | 'warmup' | 'documents' | 'queries' | 'saving';
  completedQueries: number;
  totalQueries: number;
  startedAt?: string;
  error?: string;
  report?: ModelBenchmarkReport;
}

export interface ModelOverview {
  model: ModelInfo;
  dataset: BenchmarkDataset;
}
