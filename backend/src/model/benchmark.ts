import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type {
  BenchmarkAccuracy,
  BenchmarkCaseResult,
  BenchmarkDataset,
  ModelBenchmarkReport,
  ModelBenchmarkStatus,
  ModelInfo,
} from '@bnect/shared';
import { config } from '../config.js';
import { embeddingProvider, type LocalE5EmbeddingProvider } from '../embedding.js';
import { AppError } from '../errors.js';
import { benchmarkDataset } from './dataset.js';
import { getModelInfo } from './info.js';

type BenchmarkProvider = Pick<
  LocalE5EmbeddingProvider,
  'initialize' | 'getStatus' | 'embedQuery' | 'embedDocuments'
>;
type Progress = Pick<ModelBenchmarkStatus, 'phase' | 'completedQueries'>;
const round = (value: number) => Math.round(value * 1000) / 1000;
const elapsed = (start: number) => performance.now() - start;

/** Nearest-rank percentile, also used for the even-sized sample's median. */
export function percentile(values: number[], fraction: number): number {
  if (!values.length) throw new Error('Нет измерений для расчёта перцентиля.');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

export function accuracy(results: Pick<BenchmarkCaseResult, 'rank'>[]): BenchmarkAccuracy {
  const count = results.length;
  return {
    count,
    top1: count ? results.filter((result) => result.rank === 1).length / count : 0,
    top3: count ? results.filter((result) => result.rank <= 3).length / count : 0,
    mrr: count ? results.reduce((sum, result) => sum + 1 / result.rank, 0) / count : 0,
  };
}

export async function runModelBenchmark(
  provider: BenchmarkProvider = embeddingProvider,
  onProgress: (progress: Progress) => void = () => undefined,
  dataset: BenchmarkDataset = benchmarkDataset,
  info: () => Promise<ModelInfo> = getModelInfo,
): Promise<ModelBenchmarkReport> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  onProgress({ phase: 'loading', completedQueries: 0 });
  const modelWasReady = provider.getStatus().state === 'ready';
  const loadStart = performance.now();
  await provider.initialize();
  const modelLoadMs = elapsed(loadStart);

  // Measure the first ONNX invocation separately from steady-state inference.
  onProgress({ phase: 'warmup', completedQueries: 0 });
  const warmupStart = performance.now();
  await provider.embedQuery('Прогрев модели для проверки смыслового поиска', { cache: false });
  const warmupMs = elapsed(warmupStart);

  onProgress({ phase: 'documents', completedQueries: 0 });
  const documentsStart = performance.now();
  const documentVectors = await provider.embedDocuments(dataset.documents.map((item) => item.text));
  const documentEmbeddingMs = elapsed(documentsStart);
  const results: BenchmarkCaseResult[] = [];
  for (const item of dataset.cases) {
    onProgress({ phase: 'queries', completedQueries: results.length });
    const queryStart = performance.now();
    // Repeated runs must perform real inference, never use the query cache.
    const query = await provider.embedQuery(item.query, { cache: false });
    const queryMs = elapsed(queryStart);
    const rankingStart = performance.now();
    // Production E5 vectors are L2-normalized: dot product equals cosine similarity.
    const ranked = documentVectors
      .map((vector, index) => ({
        ...dataset.documents[index]!,
        similarity: vector.reduce((sum, value, i) => sum + value * query[i]!, 0),
      }))
      .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
    const rank = ranked.findIndex((document) => document.id === item.expectedId) + 1;
    if (!rank)
      throw new Error(`В тестовом корпусе отсутствует ожидаемый ответ ${item.expectedId}.`);
    const expected = ranked[rank - 1]!;
    results.push({
      ...item,
      expectedText: expected.text,
      rank,
      similarity: expected.similarity,
      queryMs: round(queryMs),
      rankingMs: round(elapsed(rankingStart)),
      top: ranked.slice(0, 3),
    });
  }

  // Populate the normal query cache; then measure only actual cache hits.
  await provider.embedQuery(dataset.cases[0]!.query);
  const cacheTimes: number[] = [];
  for (let sample = 0; sample < 10; sample++) {
    const cacheStart = performance.now();
    await provider.embedQuery(dataset.cases[0]!.query);
    cacheTimes.push(elapsed(cacheStart));
  }
  const times = results.map((result) => result.queryMs);
  const queryTotalMs = times.reduce((sum, time) => sum + time, 0);
  const model = await info();
  return {
    id: randomUUID(),
    datasetVersion: dataset.version,
    startedAt,
    completedAt: new Date().toISOString(),
    model,
    documentCount: dataset.documents.length,
    queryCount: results.length,
    timing: {
      totalMs: round(elapsed(started)),
      modelLoadMs: round(modelLoadMs),
      modelWasReady,
      warmupMs: round(warmupMs),
      documentEmbeddingMs: round(documentEmbeddingMs),
      documentsPerSecond: round((dataset.documents.length * 1000) / documentEmbeddingMs),
      queryMedianMs: round(percentile(times, 0.5)),
      queryP95Ms: round(percentile(times, 0.95)),
      queryMeanMs: round(queryTotalMs / times.length),
      queriesPerSecond: round((times.length * 1000) / queryTotalMs),
      cachedQueryMedianMs: round(percentile(cacheTimes, 0.5)),
      cachedQuerySamples: cacheTimes.length,
    },
    accuracy: accuracy(results),
    byCategory: {
      synonym: accuracy(results.filter((item) => item.category === 'synonym')),
      paraphrase: accuracy(results.filter((item) => item.category === 'paraphrase')),
      abbreviation: accuracy(results.filter((item) => item.category === 'abbreviation')),
    },
    cases: results,
  };
}

/** One benchmark job per backend; polling and reloads never launch extra inference. */
export class ModelBenchmarkService {
  private current: ModelBenchmarkStatus = {
    state: 'idle',
    phase: 'idle',
    completedQueries: 0,
    totalQueries: benchmarkDataset.cases.length,
  };
  private restored?: Promise<void>;
  private task?: Promise<void>;

  constructor(
    private readonly provider: BenchmarkProvider = embeddingProvider,
    private readonly reportPath = path.join(config.rootDir, 'output/model-benchmark/latest.json'),
    private readonly info: () => Promise<ModelInfo> = getModelInfo,
  ) {}

  private async restore(): Promise<void> {
    try {
      const report = JSON.parse(await readFile(this.reportPath, 'utf8')) as ModelBenchmarkReport;
      if (
        report.datasetVersion !== benchmarkDataset.version ||
        report.model.id !== config.modelId ||
        report.model.revision !== config.modelRevision ||
        report.model.embeddingVersion !== config.embeddingVersion ||
        report.queryCount !== benchmarkDataset.cases.length ||
        !Array.isArray(report.cases) ||
        report.cases.length !== report.queryCount ||
        !Number.isFinite(report.timing.queryMedianMs)
      )
        return;
      this.current = {
        ...this.current,
        state: 'completed',
        completedQueries: report.queryCount,
        report,
      };
    } catch {
      // Missing, partial or outdated reports do not prevent a new run.
    }
  }

  async status(): Promise<ModelBenchmarkStatus> {
    this.restored ??= this.restore();
    await this.restored;
    return { ...this.current };
  }

  async start(): Promise<ModelBenchmarkStatus> {
    await this.status();
    if (this.current.state === 'running')
      throw new AppError(
        409,
        'BENCHMARK_RUNNING',
        'Бенчмарк уже выполняется. Дождитесь результата.',
      );
    this.current = {
      state: 'running',
      phase: 'loading',
      completedQueries: 0,
      totalQueries: benchmarkDataset.cases.length,
      startedAt: new Date().toISOString(),
      report: this.current.report,
    };
    this.task = this.execute();
    return { ...this.current };
  }

  private async execute(): Promise<void> {
    try {
      const report = await runModelBenchmark(
        this.provider,
        (progress) => {
          this.current = { ...this.current, ...progress };
        },
        benchmarkDataset,
        this.info,
      );
      this.current = { ...this.current, phase: 'saving', completedQueries: report.queryCount };
      await mkdir(path.dirname(this.reportPath), { recursive: true });
      const temporary = `${this.reportPath}.${report.id}.tmp`;
      await writeFile(temporary, JSON.stringify(report, null, 2), 'utf8');
      await rename(temporary, this.reportPath);
      this.current = { ...this.current, state: 'completed', phase: 'idle', report };
    } catch (error) {
      this.current = {
        ...this.current,
        state: 'error',
        phase: 'idle',
        error:
          error instanceof AppError
            ? error.message
            : 'Не удалось выполнить или сохранить бенчмарк. Проверьте модель и каталог output/model-benchmark.',
      };
    }
  }

  async wait(): Promise<ModelBenchmarkStatus> {
    await this.task;
    return this.status();
  }
}
