import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseTenderExcel } from '../data/excel.js';
import { embeddingProvider } from '../embedding.js';
import type { TenderRepository } from '../repository.js';
import { fileImportState } from '../tender-file.js';

const excelImportSchema = z.object({
  fileName: z.string().regex(/\.xlsx$/i, 'Поддерживается .xlsx'),
  dataBase64: z
    .string()
    .min(1)
    .max(7_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  dryRun: z.boolean(),
});

export function registerTenderImportRoutes(
  app: FastifyInstance,
  repository: TenderRepository,
): void {
  app.get('/api/import-status', () => fileImportState);
  app.post('/api/index', () => repository.index(embeddingProvider, false));

  app.post('/api/imports/excel', { bodyLimit: 8 * 1024 * 1024 }, async (request) => {
    const body = excelImportSchema.parse(request.body);
    const parsed = await parseTenderExcel(Buffer.from(body.dataBase64, 'base64'));
    if (parsed.errors.length)
      return { ...parsed, tenders: undefined, imported: false, dryRun: body.dryRun };

    const changes = await repository.upsertTenders(parsed.tenders, { dryRun: body.dryRun });
    let indexError: string | undefined;
    if (!body.dryRun) {
      try {
        await repository.index(embeddingProvider, false);
      } catch (error) {
        indexError = error instanceof Error ? error.message : 'Индексация недоступна';
      }
    }
    return {
      totalRows: parsed.totalRows,
      validRows: parsed.tenders.length,
      sheetName: parsed.sheetName,
      errors: parsed.errors,
      duplicates: parsed.duplicates,
      changes,
      imported: !body.dryRun,
      dryRun: body.dryRun,
      indexError,
    };
  });
}
