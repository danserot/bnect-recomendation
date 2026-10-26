import Fastify from 'fastify';
import type { PurchaseRepository } from './analytics/repository.js';
import { registerPurchaseRoutes } from './analytics/routes.js';
import { registerHttpErrors } from './http-errors.js';
import { TenderRepository } from './repository.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSupplierRoutes } from './routes/suppliers.js';
import { registerTenderImportRoutes } from './routes/tender-imports.js';
import { registerTenderRoutes } from './routes/tenders.js';
import { RecommendationService } from './service.js';
import { DemoSupplierSourceAdapter } from './suppliers.js';

interface AppOptions {
  purchaseRepository?: PurchaseRepository;
}

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: true, disableRequestLogging: true, bodyLimit: 32 * 1024 });
  const repository = new TenderRepository();
  const service = new RecommendationService(repository);
  const suppliers = new DemoSupplierSourceAdapter();

  registerHttpErrors(app);
  registerHealthRoutes(app, repository);
  registerTenderRoutes(app, repository, service);
  registerTenderImportRoutes(app, repository);
  registerSupplierRoutes(app, suppliers);
  registerPurchaseRoutes(app, options.purchaseRepository);
  return app;
}
