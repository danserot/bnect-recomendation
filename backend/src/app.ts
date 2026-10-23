import Fastify from 'fastify';
import { z, ZodError } from 'zod';
import { parseTenderExcel } from './data/excel.js';
import { fileImportState } from './tender-file.js';
import { config } from './config.js';
import { dbQuery } from './db.js';
import { embeddingProvider } from './embedding.js';
import { AppError, databaseError } from './errors.js';
import { DemoSupplierSourceAdapter, TenderRepository } from './repository.js';
import { RecommendationService } from './service.js';
import { listQuerySchema, recommendationSchema, supplierSchema } from './validation.js';
import { resolveFilters } from './filters.js';

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 32 * 1024 });
  const repository = new TenderRepository();
  const suppliers = new DemoSupplierSourceAdapter();
  const service = new RecommendationService(repository);
  app.get('/api/import-status', () => fileImportState);

  app.post('/api/imports/excel', { bodyLimit: 8 * 1024 * 1024 }, async (request) => {
    const body = z
      .object({
        fileName: z.string().regex(/\.xlsx$/i, 'Поддерживается .xlsx'),
        dataBase64: z
          .string()
          .min(1)
          .max(7_000_000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        dryRun: z.boolean(),
      })
      .parse(request.body);
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
  app.post('/api/index', async () => repository.index(embeddingProvider, false));
  app.get('/api/vector-space', async (request) => {
    const { tenderId } = z.object({ tenderId: z.string().min(1).optional() }).parse(request.query);
    return service.tenderVectorSpace(tenderId);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Проверьте поля запроса.',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    if ((error as { statusCode?: number }).statusCode === 400)
      return reply
        .code(400)
        .send({ error: 'INVALID_REQUEST', message: 'Некорректный JSON или параметры запроса.' });
    request.log.error(error);
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера. Подробности доступны в журнале backend.',
    });
  });

  app.get('/api/health', async (_request, reply) => {
    try {
      await dbQuery('SELECT 1');
      let index;
      try {
        index = await repository.indexStatus();
      } catch (error) {
        if (error instanceof AppError)
          return reply.code(503).send({
            status: 'unavailable',
            database: 'connected',
            model: embeddingProvider.getStatus(),
            error: error.code,
            message: error.message,
          });
        throw error;
      }
      return {
        status: 'ok',
        database: 'connected',
        model: embeddingProvider.getStatus(),
        index,
        demoNow: config.demoNow,
      };
    } catch (error) {
      const problem = error instanceof AppError ? error : databaseError();
      return reply.code(503).send({
        status: 'unavailable',
        database: 'unavailable',
        model: embeddingProvider.getStatus(),
        error: problem.code,
        message: problem.message,
      });
    }
  });
  app.get('/api/catalog', () => repository.catalog());
  app.get('/api/suppliers', () => suppliers.list());
  app.put<{ Params: { id: string } }>('/api/suppliers/:id', async (request) => {
    const profile = supplierSchema.parse(request.body);
    if (profile.id !== request.params.id)
      throw new AppError(
        400,
        'PROFILE_ID_MISMATCH',
        'ID профиля должен совпадать с адресом запроса.',
      );
    resolveFilters(profile, { regionMode: 'all', selectedRegionIds: [] });
    return suppliers.save(profile);
  });
  app.get('/api/tenders', (request) => repository.list(listQuerySchema.parse(request.query)));
  app.get<{ Params: { id: string } }>('/api/tenders/:id', (request) =>
    repository.get(request.params.id),
  );
  app.get<{ Params: { id: string } }>('/api/tenders/:id/similar', (request) =>
    service.recommendSimilar(request.params.id),
  );
  app.post('/api/recommendations', (request) =>
    service.recommend(recommendationSchema.parse(request.body)),
  );
  app.post<{ Params: { id: string } }>('/api/tenders/:id/similar', (request) =>
    service.recommend(recommendationSchema.parse(request.body), request.params.id),
  );
  app.post('/api/vector-space', (request) =>
    service.vectorSpace(recommendationSchema.parse(request.body)),
  );
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'NOT_FOUND', message: 'Адрес API не найден.' }),
  );
  return app;
}
