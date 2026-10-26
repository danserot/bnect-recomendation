import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { resolveFilters } from '../filters.js';
import type { SupplierSourceAdapter } from '../suppliers.js';
import { supplierSchema } from '../validation.js';

export function registerSupplierRoutes(
  app: FastifyInstance,
  suppliers: SupplierSourceAdapter,
): void {
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
}
