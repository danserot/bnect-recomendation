import type { FastifyInstance } from 'fastify';
import { ModelBenchmarkService } from '../model/benchmark.js';
import { benchmarkDataset } from '../model/dataset.js';
import { getModelInfo } from '../model/info.js';

export function registerModelRoutes(
  app: FastifyInstance,
  benchmark = new ModelBenchmarkService(),
): void {
  app.get('/api/model', async () => ({ model: await getModelInfo(), dataset: benchmarkDataset }));
  app.get('/api/model/benchmark', async () => benchmark.status());
  app.post('/api/model/benchmark', async (_request, reply) =>
    reply.code(202).send(await benchmark.start()),
  );
}
