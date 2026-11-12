import { describe, expect, it, vi } from 'vitest';
import { demoSuppliers, generateDemoTenders } from '../src/data/index.js';
import { contentHash, supplierText, tenderText, workSubject, projectKey } from '../src/text.js';
import { availability, isEligible, resolveFilters } from '../src/filters.js';
import { buildRecommendationConditions, TenderRepository } from '../src/repository.js';
import type { dbQuery } from '../src/db.js';
import { fitPca, PcaCache, projectPca } from '../src/pca.js';
import { recommendationSchema, similarFiltersSchema } from '../src/validation.js';

const profile = demoSuppliers[0]!;
const tender = generateDemoTenders()[0]!;

describe('stable semantic input', () => {
  it('embeds the full title and structured tender fields', () => {
    const first = {
      ...tender,
      title: 'Открытый тендер на электромонтажные работы по проекту Arman Qala',
      activity: 'Внутренние электромонтажные сети',
    };
    const second = {
      ...first,
      title: 'Запрос ценовых предложений на электромонтажные работы по проекту Tamga Hills',
    };
    expect(tenderText(first)).not.toBe(tenderText(second));
    expect(tenderText(first)).toContain('Название: ' + first.title);
    expect(tenderText(first)).toContain('Деятельность: Внутренние электромонтажные сети');
    expect(tenderText(first)).toContain('Сфера: ' + first.industryGroup);
    expect(tenderText(first)).toContain('Вид закупки: ' + first.procurementType);
    expect(tenderText(first)).toContain('Способ закупки: ' + first.procurementMethod);
    expect(workSubject('Разработка проекта электроснабжения')).toBe(
      'Разработка проекта электроснабжения',
    );
    expect(projectKey(first.title)).not.toBe(projectKey(second.title));
    expect(projectKey('Тендер на сети ЖК Gulder 3-1 оч.')).toBe(
      projectKey('Тендер на СС по проекту Gulder - 4-1 очередь'),
    );
  });
  it('excludes technical identifiers from the semantic hash', () => {
    const changed = {
      ...tender,
      id: 'different',
      externalNumber: 'OTHER-1',
    };
    expect(contentHash(tenderText(changed))).toBe(contentHash(tenderText(tender)));
    expect(contentHash(tenderText({ ...tender, title: 'Иное название' }))).not.toBe(
      contentHash(tenderText(tender)),
    );
    expect(contentHash(tenderText({ ...tender, activity: 'Иная деятельность' }))).not.toBe(
      contentHash(tenderText(tender)),
    );
  });
  it.each([
    { regionId: tender.regionId === 'astana' ? 'almaty' : 'astana' },
    { createdAt: '2000-01-01T00:00:00.000Z' },
    { industryGroup: 'Другая сфера' },
    { procurementMethod: 'Другой способ' },
    { procurementType: 'Другой вид' },
    { description: 'Подробное описание нового предмета закупки' },
    { applicationDeadline: '2030-01-01T00:00:00.000Z' },
  ])('invalidates embeddings when business fields change: %j', (change) => {
    expect(contentHash(tenderText({ ...tender, ...change }))).not.toBe(
      contentHash(tenderText(tender)),
    );
  });
  it('uses readable geography and canonical dates in the full row', () => {
    const text = tenderText({
      ...tender,
      regionId: 'astana',
      createdAt: '2026-10-01T05:00:00+05:00',
      applicationDeadline: '2026-10-20T15:00:00+05:00',
    });
    expect(text).toContain('Регион: Астана');
    expect(text).toContain('Дата создания: 2026-10-01T00:00:00.000Z');
    expect(text).toContain('Срок подачи заявок: 2026-10-20T10:00:00.000Z');
  });
  it('uses specialization, excludes company name and region, stabilizes arrays', () => {
    const changed = {
      ...profile,
      name: 'Другое имя',
      id: 'other',
      serviceRegionIds: [],
      industryGroups: [...profile.industryGroups].reverse(),
      activities: [...profile.activities].reverse(),
    };
    expect(supplierText(changed)).toBe(supplierText(profile));
    expect(supplierText(profile)).toContain(profile.specializationDescription);
  });
});

describe('explicit filters and input validation', () => {
  it('supports tender-to-tender search without any supplier profile', () => {
    const filters = resolveFilters(profile, { regionMode: 'all', selectedRegionIds: [] });
    expect(buildRecommendationConditions(undefined, filters, 'selected')).toEqual({
      clauses: ['TRUE', 'id <> $1'],
      values: ['selected'],
    });
    expect(() =>
      buildRecommendationConditions(undefined, { ...filters, applySupplierIndustryGroups: true }),
    ).toThrow('нужен профиль');
  });
  it('requires at least one region in limited modes', () => {
    expect(() =>
      resolveFilters(
        { ...profile, serviceRegionIds: [] },
        { regionMode: 'supplier', selectedRegionIds: [] },
      ),
    ).toThrow('хотя бы один регион');
    expect(() =>
      resolveFilters(profile, { regionMode: 'selected', selectedRegionIds: [] }),
    ).toThrow('хотя бы один регион');
  });
  it('does not treat an unknown region as a substring match', () => {
    expect(() =>
      resolveFilters(profile, {
        regionMode: 'selected',
        selectedRegionIds: ['astana-unrecognized'],
      }),
    ).toThrow('неизвестный');
  });
  it('keeps unknown tender geography only in all-regions mode', () => {
    const unknown = { ...tender, regionId: null };
    expect(
      isEligible(
        unknown,
        profile,
        resolveFilters(profile, { regionMode: 'all', selectedRegionIds: [] }),
      ),
    ).toBe(true);
    expect(
      isEligible(
        unknown,
        profile,
        resolveFilters(profile, { regionMode: 'supplier', selectedRegionIds: [] }),
      ),
    ).toBe(false);
  });
  it('preserves empty enabled profile restrictions as zero eligible records', () => {
    const empty = { ...profile, industryGroups: [] };
    const filters = resolveFilters(empty, {
      regionMode: 'all',
      selectedRegionIds: [],
      applySupplierIndustryGroups: true,
    });
    expect(isEligible(tender, empty, filters)).toBe(false);
    expect(buildRecommendationConditions(empty, filters).values).toEqual([[]]);
  });
  it('uses strict future deadline relative to explicit clock, never createdAt', () => {
    const filters = resolveFilters(profile, {
      regionMode: 'all',
      selectedRegionIds: [],
      onlyOpen: true,
    });
    expect(
      isEligible(
        { ...tender, status: 'open', applicationDeadline: '2026-10-23T09:00:00.000Z' },
        profile,
        filters,
      ),
    ).toBe(false);
    expect(
      isEligible(
        { ...tender, status: 'open', applicationDeadline: '2026-10-23T09:00:01.000Z' },
        profile,
        filters,
      ),
    ).toBe(true);
    expect(
      availability({
        ...tender,
        source: 'import',
        status: undefined,
        applicationDeadline: undefined,
      }),
    ).toBe('Доступность участия неизвестна');
  });
  it('validates profile and rejects hidden unsupported parameters', () => {
    expect(() =>
      recommendationSchema.parse({
        profile: { ...profile, specializationDescription: '' },
        filters: { regionMode: 'all', selectedRegionIds: [] },
      }),
    ).toThrow();
    expect(() =>
      recommendationSchema.parse({
        profile,
        filters: { regionMode: 'all', selectedRegionIds: [], hiddenBonus: 10 },
      }),
    ).toThrow();
  });
  it('builds intersected parameterized constraints and excludes source tender', () => {
    const filters = resolveFilters(profile, {
      regionMode: 'supplier',
      selectedRegionIds: [],
      activities: ['Ремонт помещений'],
      procurementMethods: ['Открытый конкурс'],
      applySupplierIndustryGroups: true,
    });
    const query = buildRecommendationConditions(profile, filters, 'source');
    expect(query.clauses).toEqual([
      'TRUE',
      'region_id = ANY($1::text[])',
      'activity = ANY($2::text[])',
      'procurement_method = ANY($3::text[])',
      'industry_group = ANY($4::text[])',
      'id <> $5',
    ]);
    expect(query.values[4]).toBe('source');
  });
  it('validates filters for the profile-free similar-tender API', () => {
    expect(
      similarFiltersSchema.parse({
        activities: ['Ремонт помещений'],
        procurementTypes: ['Работы'],
      }),
    ).toEqual({ activities: ['Ремонт помещений'], procurementTypes: ['Работы'] });
    expect(() => similarFiltersSchema.parse({ hiddenBoost: 10 })).toThrow();
    const filters = resolveFilters(profile, {
      regionMode: 'all',
      selectedRegionIds: [],
      activities: [tender.activity],
    });
    expect(isEligible(tender, profile, filters)).toBe(true);
    expect(isEligible({ ...tender, activity: 'Иное' }, profile, filters)).toBe(false);
  });
  it('applies filters before cosine ranking without activity or date priority', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('count(*)') ? [{ total: 10, candidates: 3 }] : [],
      rowCount: 0,
    }));
    const repository = new TenderRepository(query as unknown as typeof dbQuery);
    const filters = resolveFilters(profile, {
      regionMode: 'all',
      selectedRegionIds: [],
      activities: ['Ремонт помещений'],
    });
    await repository.search(Array(384).fill(0), undefined, filters);
    const sql = query.mock.calls[1]![0];
    expect(sql).toContain('WHERE TRUE AND activity = ANY($1::text[]) AND embedding IS NOT NULL');
    expect(sql).toContain('ORDER BY distance ASC, id ASC LIMIT 5');
    expect(sql).not.toContain('created_at -');
  });
});

describe('real-data deterministic PCA transformation', () => {
  it('centers, finds principal direction and projects new query through same axes', () => {
    const vectors = [
      [-2, 0, 1],
      [-1, 0, 1],
      [1, 0, 1],
      [2, 0, 1],
    ];
    const pca = fitPca(vectors);
    expect(pca.mean).toEqual([0, 0, 1]);
    expect(pca.components[0]![0]).toBeCloseTo(1, 8);
    expect(pca.explainedVarianceRatio[0]).toBeCloseTo(1, 8);
    expect(projectPca([3, 0, 1], pca)[0]).toBeCloseTo(3, 8);
    expect(fitPca(vectors)).toEqual(pca);
  });
  it('caches fit until embedding dataset changes, independent of profile', () => {
    const cache = new PcaCache();
    const rows = [
      { id: 'a', vector: [1, 0], contentHash: 'h1', embeddedAt: 'time1' },
      { id: 'b', vector: [0, 1], contentHash: 'h2', embeddedAt: 'time1' },
    ];
    const first = cache.get(rows);
    expect(cache.get(rows)).toBe(first);
    expect(cache.get([{ ...rows[0]!, embeddedAt: 'time2' }, rows[1]!])).not.toBe(first);
  });
});
