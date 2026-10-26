import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { parsePurchaseExcel } from './import.js';
import { PurchaseRepository } from './repository.js';

const querySchema = z
  .object({
    q: z.string().trim().max(300).default(''),
    product: z.string().max(4000).optional(),
    region: z.string().max(4000).optional(),
    status: z.string().max(4000).optional(),
    period: z.enum(['1', '3', '6', '12', 'all']).default('6'),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    selectedId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    comparisonRegion: z.string().max(4000).optional(),
  })
  .refine(
    (query) => !query.comparisonRegion || query.comparisonRegion !== query.region,
    'Дополнительный регион должен отличаться от основного.',
  );

const productSearchSchema = z.object({ q: z.string().trim().min(2).max(300) });

const importSchema = z.object({
  fileName: z
    .string()
    .max(255)
    .regex(/\.xlsx$/i),
  dataBase64: z
    .string()
    .min(1)
    .max(7_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  sheet: z.string().max(200).optional(),
  dryRun: z.boolean(),
});

async function readImportReport(): Promise<unknown> {
  try {
    const path = join(config.rootDir, 'output', 'analytics', 'import-report.json');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function registerPurchaseRoutes(
  app: FastifyInstance,
  repository = new PurchaseRepository(),
) {
  app.get('/api/analytics/options', () => repository.options());
  app.get('/api/analytics/readiness', () => repository.readiness());
  app.get('/api/analytics/import-status', readImportReport);
  app.get('/api/analytics/products', (request) => {
    const { q } = productSearchSchema.parse(request.query);
    return repository.products(q);
  });
  app.get('/api/analytics/purchases', (request) =>
    repository.analytics(querySchema.parse(request.query)),
  );
  app.post('/api/analytics/import', { bodyLimit: 8 * 1024 * 1024 }, async (request) => {
    const body = importSchema.parse(request.body);
    const { report, records } = await parsePurchaseExcel(
      Buffer.from(body.dataBase64, 'base64'),
      body.fileName,
      body.sheet,
    );
    if (!body.dryRun && records.length) {
      report.inserted = await repository.import(records);
      report.imported = true;
    }
    return report;
  });
}
