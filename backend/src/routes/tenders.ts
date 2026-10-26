import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TenderRepository } from '../repository.js';
import type { RecommendationService } from '../service.js';
import { listQuerySchema, recommendationSchema } from '../validation.js';

type TenderRoute = { Params: { id: string } };
const vectorSpaceQuerySchema = z.object({ tenderId: z.string().min(1).optional() });

export function registerTenderRoutes(
  app: FastifyInstance,
  repository: TenderRepository,
  service: RecommendationService,
): void {
  app.get('/api/catalog', () => repository.catalog());
  app.get('/api/tenders', (request) => repository.list(listQuerySchema.parse(request.query)));
  app.get<TenderRoute>('/api/tenders/:id', (request) => repository.get(request.params.id));
  app.get<TenderRoute>('/api/tenders/:id/similar', (request) =>
    service.recommendSimilar(request.params.id),
  );
  app.post<TenderRoute>('/api/tenders/:id/similar', (request) =>
    service.recommend(recommendationSchema.parse(request.body), request.params.id),
  );
  app.post('/api/recommendations', (request) =>
    service.recommend(recommendationSchema.parse(request.body)),
  );
  app.get('/api/vector-space', (request) => {
    const { tenderId } = vectorSpaceQuerySchema.parse(request.query);
    return service.tenderVectorSpace(tenderId);
  });
  app.post('/api/vector-space', (request) =>
    service.vectorSpace(recommendationSchema.parse(request.body)),
  );
}
