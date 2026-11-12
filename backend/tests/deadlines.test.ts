import { describe, expect, it } from 'vitest';
import { deadlineBounds, matchesDeadline } from '../src/deadlines.js';
import { listQuerySchema, recommendationSchema, similarFiltersSchema } from '../src/validation.js';
import { demoSuppliers, generateDemoTenders } from '../src/data/index.js';
import { buildRecommendationConditions } from '../src/repository.js';
import { isEligible, resolveFilters } from '../src/filters.js';

const tender = generateDemoTenders()[0]!;
const dates = { deadlineFrom: '2026-11-10', deadlineTo: '2026-11-10' };

describe('deadline calendar filters in UTC+5', () => {
  it('includes the entire selected last day without including the next day', () => {
    expect(deadlineBounds(dates)).toEqual({
      from: '2026-11-09T19:00:00.000Z',
      to: '2026-11-10T19:00:00.000Z',
    });
  });
  it.each([
    ['2026-11-09T18:59:59.999Z', false],
    ['2026-11-09T19:00:00.000Z', true],
    ['2026-11-10T18:59:59.999Z', true],
    ['2026-11-10T19:00:00.000Z', false],
  ])('matches SQL boundaries for %s', (applicationDeadline, expected) => {
    const candidate = { ...tender, applicationDeadline };
    expect(matchesDeadline(candidate, dates)).toBe(expected);
    expect(
      isEligible(
        candidate,
        undefined,
        resolveFilters(undefined, { regionMode: 'all', selectedRegionIds: [], ...dates }),
      ),
    ).toBe(expected);
  });
  it('supports either bound independently and does not infer a missing deadline from createdAt', () => {
    const missing = { ...tender, applicationDeadline: undefined };
    expect(matchesDeadline(missing, {})).toBe(true);
    expect(matchesDeadline(missing, { deadlineFrom: dates.deadlineFrom })).toBe(false);
    expect(matchesDeadline(missing, { deadlineTo: dates.deadlineTo })).toBe(false);
    expect(
      matchesDeadline(
        { ...tender, applicationDeadline: '2026-11-10T12:00:00Z' },
        { deadlineTo: dates.deadlineTo },
      ),
    ).toBe(true);
  });
  it('binds exact timestamp limits before ranking and excludes the source', () => {
    const filters = resolveFilters(undefined, {
      regionMode: 'all',
      selectedRegionIds: [],
      ...dates,
    });
    expect(buildRecommendationConditions(undefined, filters, 'source')).toEqual({
      clauses: [
        'TRUE',
        'application_deadline >= $1::timestamptz',
        'application_deadline < $2::timestamptz',
        'id <> $3',
      ],
      values: ['2026-11-09T19:00:00.000Z', '2026-11-10T19:00:00.000Z', 'source'],
    });
  });
  it('validates dates and ranges consistently for all three APIs', () => {
    for (const filters of [
      { deadlineFrom: '2026-02-30' },
      { deadlineTo: '10.11.2026' },
      { deadlineFrom: '2026-11-11', deadlineTo: '2026-11-10' },
    ]) {
      expect(similarFiltersSchema.safeParse(filters).success).toBe(false);
      expect(listQuerySchema.safeParse(filters).success).toBe(false);
      expect(
        recommendationSchema.safeParse({
          profile: demoSuppliers[0],
          filters: { regionMode: 'all', selectedRegionIds: [], ...filters },
        }).success,
      ).toBe(false);
    }
    expect(similarFiltersSchema.parse(dates)).toEqual(dates);
    expect(listQuerySchema.parse(dates)).toMatchObject(dates);
  });
});
