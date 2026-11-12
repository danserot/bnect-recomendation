import { afterEach, describe, expect, test, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BenchmarkDataset } from '@bnect/shared';
import { config } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { registerHttpErrors } from '../src/http-errors.js';
import {
  accuracy,
  ModelBenchmarkService,
  percentile,
  runModelBenchmark,
} from '../src/model/benchmark.js';
import { benchmarkDataset } from '../src/model/dataset.js';
import { registerModelRoutes } from '../src/routes/model.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function reportPath() {
  const directory = await mkdtemp(join(tmpdir(), 'bnect-model-test-'));
  directories.push(directory);
  return join(directory, 'latest.json');
}
// Controlled vectors test metric calculation and job orchestration only.
// Model quality itself is measured by the real ONNX benchmark, never by this mock.
function provider() {
  return {
    initialize: vi.fn(async () => undefined),
    getStatus: () => ({
      state: 'ready' as const,
      modelId: config.modelId,
      dimensions: config.dimensions,
      version: config.embeddingVersion,
      error: undefined,
    }),
    embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
    embedQuery: vi.fn(async (_text: string, _options?: { cache?: boolean }) => [1, 0]),
  };
}

test('synthetic corpus has distinct queries, one known target and a hard negative per query', () => {
  expect(benchmarkDataset.cases).toHaveLength(24);
  expect(benchmarkDataset.documents).toHaveLength(48);
  expect(new Set(benchmarkDataset.documents.map((item) => item.id)).size).toBe(48);
  expect(new Set(benchmarkDataset.documents.map((item) => item.text)).size).toBe(48);
  expect(new Set(benchmarkDataset.cases.map((item) => item.query)).size).toBe(24);
  for (const item of benchmarkDataset.cases) {
    expect(
      benchmarkDataset.documents.filter((document) => document.id === item.expectedId),
    ).toHaveLength(1);
    expect(benchmarkDataset.documents.some((document) => document.text === item.query)).toBe(false);
  }
});

test('nearest-rank percentiles and reciprocal ranks include failures', () => {
  expect(percentile([10, 40, 20, 30], 0.5)).toBe(20);
  expect(
    percentile(
      Array.from({ length: 24 }, (_, index) => index + 1),
      0.95,
    ),
  ).toBe(23);
  expect(accuracy([{ rank: 1 }, { rank: 2 }, { rank: 4 }])).toEqual({
    count: 3,
    top1: 1 / 3,
    top3: 2 / 3,
    mrr: (1 + 0.5 + 0.25) / 3,
  });
});

test('benchmark ranks against the full corpus and bypasses cache on every measured query', async () => {
  const model = provider();
  const dataset: BenchmarkDataset = {
    version: 'controlled-vectors',
    description: 'Synthetic metric verification',
    documents: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ],
    cases: [
      { id: '1', category: 'synonym', label: 'A', query: 'first', expectedId: 'a' },
      { id: '2', category: 'paraphrase', label: 'C', query: 'second', expectedId: 'c' },
    ],
  };
  model.embedDocuments.mockResolvedValue([
    [1, 0],
    [0, 1],
    [-1, 0],
  ]);
  model.embedQuery.mockImplementation(async (text) => (text === 'second' ? [-1, 0] : [0.6, 0.8]));
  const result = await runModelBenchmark(model, undefined, dataset);
  expect(result.cases.map((item) => item.rank)).toEqual([2, 1]);
  expect(result.cases[0].top.map((item) => item.id)).toEqual(['b', 'a', 'c']);
  expect(result.accuracy).toEqual({ count: 2, top1: 0.5, top3: 1, mrr: 0.75 });
  expect(result.byCategory.synonym.top1).toBe(0);
  expect(result.byCategory.paraphrase.top1).toBe(1);
  expect(result.timing.cachedQuerySamples).toBe(10);
  for (const item of dataset.cases)
    expect(model.embedQuery).toHaveBeenCalledWith(item.query, { cache: false });
  expect(
    model.embedQuery.mock.calls.filter(([, options]) => options?.cache === false),
  ).toHaveLength(3);
});

describe('benchmark API and report lifecycle', () => {
  test('returns 202, rejects overlapping runs, saves and restores results without inference', async () => {
    const file = await reportPath();
    const model = provider();
    let release!: () => void;
    model.initialize.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const service = new ModelBenchmarkService(model, file);
    const app = Fastify();
    registerHttpErrors(app);
    registerModelRoutes(app, service);
    try {
      const overview = await app.inject({ method: 'GET', url: '/api/model' });
      expect(overview.statusCode).toBe(200);
      expect(overview.json().model.remoteDownloads).toBe(false);
      expect(model.initialize).not.toHaveBeenCalled();
      const started = await app.inject({
        method: 'POST',
        url: '/api/model/benchmark',
        payload: {},
      });
      expect(started.statusCode).toBe(202);
      expect(started.json().state).toBe('running');
      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/model/benchmark',
        payload: {},
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().error).toBe('BENCHMARK_RUNNING');
      release();
      const finished = await service.wait();
      expect(finished.state).toBe('completed');
      expect(finished.completedQueries).toBe(24);
      expect(JSON.parse(await readFile(file, 'utf8')).id).toBe(finished.report!.id);
      const restoredModel = provider();
      const restored = new ModelBenchmarkService(restoredModel, file);
      expect((await restored.status()).report!.id).toBe(finished.report!.id);
      expect(restoredModel.initialize).not.toHaveBeenCalled();
      await service.start();
      expect((await service.wait()).report!.id).not.toBe(finished.report!.id);
    } finally {
      release?.();
      await service.wait();
      await app.close();
    }
  });

  test('missing model produces a visible error and a later request can retry', async () => {
    const model = provider();
    model.initialize.mockRejectedValueOnce(
      new AppError(503, 'MODEL_UNAVAILABLE', 'Файлы модели недоступны.'),
    );
    const service = new ModelBenchmarkService(model, await reportPath());
    await service.start();
    expect(await service.wait()).toMatchObject({
      state: 'error',
      error: 'Файлы модели недоступны.',
    });
    await service.start();
    expect((await service.wait()).state).toBe('completed');
  });
});
