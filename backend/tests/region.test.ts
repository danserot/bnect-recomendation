import { describe, expect, it, vi } from 'vitest';
import type { RecommendationRequest, ResolvedFilters, SupplierProfile } from '@bnect/shared';
import { demoSuppliers, generateDemoTenders } from '../src/data/index.js';
import { buildRecommendationConditions, TenderRepository } from '../src/repository.js';
import { RecommendationService } from '../src/service.js';
import { isEligible } from '../src/filters.js';

const profile = demoSuppliers[0]!;

function setup(regionId: string | null) {
  const selected = { ...generateDemoTenders()[0]!, regionId };
  const search = vi.fn(
    async (
      _vector: number[],
      _profile: SupplierProfile | undefined,
      _filters: ResolvedFilters,
    ) => ({ rows: [], candidateCount: 0, totalCount: 100 }),
  );
  const repository = {
    assertIndexReady: vi.fn(async () => undefined),
    get: vi.fn(async () => selected),
    search,
    readSnapshot: async (read: (repo: TenderRepository) => Promise<unknown>) =>
      read(repository as unknown as TenderRepository),
  };
  const service = new RecommendationService(repository as unknown as TenderRepository, {
    embedQuery: async () => [1, 0],
    embedDocuments: async () => [],
  });
  return { selected, service, search };
}

describe('explicit geography filters before full-row similarity ranking', () => {
  it.each(['astana', 'atyrau', 'almaty', 'almaty-region'])(
    'searches all cities by default when the source is in %s',
    async (regionId) => {
      const { service, selected, search } = setup(regionId);
      const response = await service.recommendSimilar(selected.id);
      const filters = search.mock.calls[0]![2];
      expect(search).toHaveBeenCalledWith([1, 0], undefined, filters, selected.id);
      expect(filters).toMatchObject({ regionMode: 'all', regionIds: [] });
      const sql = buildRecommendationConditions(undefined, filters, selected.id);
      expect(sql.clauses).toEqual(['TRUE', 'id <> $1']);
      expect(sql.values).toEqual([selected.id]);
      expect(response.filters).toEqual(filters);
      expect(isEligible({ ...selected, regionId: 'karaganda' }, profile, filters)).toBe(true);
      expect(isEligible({ ...selected, regionId: null }, profile, filters)).toBe(true);
    },
  );

  it('can recommend tenders when source geography is unknown', async () => {
    const { service, selected } = setup(null);
    const response = await service.recommendSimilar(selected.id);
    expect(response.filters).toMatchObject({ regionMode: 'all', regionIds: [] });
    expect(buildRecommendationConditions(undefined, response.filters).values).toEqual([]);
    expect(isEligible(selected, profile, response.filters)).toBe(true);
    expect(response.results).toEqual([]);
  });
  it('applies the explicitly selected city, activity and service filters together', async () => {
    const { service, selected, search } = setup('astana');
    const response = await service.recommendSimilar(selected.id, {
      regionIds: ['almaty'],
      activities: ['Ремонт помещений'],
      procurementTypes: ['Услуги'],
    });
    const filters = search.mock.calls[0]![2];
    expect(filters).toMatchObject({
      regionIds: ['almaty'],
      activities: ['Ремонт помещений'],
      procurementTypes: ['Услуги'],
    });
    expect(buildRecommendationConditions(undefined, filters, selected.id).clauses).toEqual([
      'TRUE',
      'region_id = ANY($1::text[])',
      'activity = ANY($2::text[])',
      'procurement_type = ANY($3::text[])',
      'id <> $4',
    ]);
    expect(response.query.text).toBeDefined();
    expect(isEligible({ ...selected, regionId: 'astana' }, profile, filters)).toBe(false);
  });
  it('rejects unknown city IDs', async () => {
    const { service, selected } = setup('astana');
    await expect(
      service.recommendSimilar(selected.id, { regionIds: ['unknown-city'] }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_REGION' });
  });

  it.each([
    ['all', [], []],
    ['selected', ['astana', 'atyrau'], ['astana', 'atyrau']],
    ['selected', ['atyrau'], ['atyrau']],
  ] as const)(
    'preserves explicit legacy POST filters with %s / %j',
    async (regionMode, ids, expected) => {
      const { service, selected, search } = setup('astana');
      const request: RecommendationRequest = {
        profile,
        filters: { regionMode, selectedRegionIds: [...ids] },
      };
      const response = await service.recommend(request, selected.id);
      expect(response.filters.regionMode).toBe(regionMode);
      expect(response.filters.regionIds).toEqual(expected);
      expect(search).toHaveBeenCalledWith([1, 0], profile, response.filters, selected.id);
    },
  );
});
