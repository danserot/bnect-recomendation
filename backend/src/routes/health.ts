import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { dbQuery } from '../db.js';
import { embeddingProvider } from '../embedding.js';
import { AppError, databaseError } from '../errors.js';
import type { TenderRepository } from '../repository.js';

export function registerHealthRoutes(app: FastifyInstance, repository: TenderRepository): void {
  app.get('/api/health', async (_request, reply) => {
    let databaseConnected = false;
    try {
      await dbQuery('SELECT 1');
      databaseConnected = true;
      const index = await repository.indexStatus();
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
        database: databaseConnected && error instanceof AppError ? 'connected' : 'unavailable',
        model: embeddingProvider.getStatus(),
        error: problem.code,
        message: problem.message,
      });
    }
  });
}
