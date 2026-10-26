import { describe, expect, it } from 'vitest';
import { chartGrouping, dateBounds, priceBuckets } from '../src/analytics/period.js';

describe('purchase analytics calendar periods', () => {
  it('uses the current date in UTC+5 when UTC is still on the previous day', () => {
    expect(dateBounds('1', new Date('2026-10-25T20:00:00Z'))).toEqual({
      from: '2026-09-26',
      to: '2026-10-26',
    });
  });

  it('clamps month-end dates in both ordinary and leap years', () => {
    expect(dateBounds('1', new Date('2026-03-31T12:00:00Z')).from).toBe('2026-02-28');
    expect(dateBounds('1', new Date('2024-03-31T12:00:00Z')).from).toBe('2024-02-29');
    expect(dateBounds('12', new Date('2024-02-29T12:00:00Z')).from).toBe('2023-02-28');
  });

  it('leaves the start open for the entire observed period', () => {
    expect(dateBounds('all', new Date('2026-10-26T12:00:00Z'))).toEqual({
      from: null,
      to: '2026-10-26',
    });
  });

  it('selects grouping by both the time span and the number of dated rows', () => {
    expect(chartGrouping('2026-10-01', '2026-10-26', 10)).toBe('day');
    expect(chartGrouping('2026-10-01', '2026-10-26', 1000)).toBe('week');
    expect(chartGrouping('2026-08-01', '2026-10-26', 10)).toBe('week');
    expect(chartGrouping('2026-01-01', '2026-10-26', 10)).toBe('month');
  });

  it('clips partial months and retains gaps independently for both regions', () => {
    const observed = { price: 100, count: 2, volume: 10, method: 'weighted' as const };
    const buckets = priceBuckets({
      first: '2026-08-25',
      last: '2026-10-26',
      grouping: 'month',
      period: { from: '2026-08-25', to: '2026-10-26' },
      mainRegion: 'Основной',
      comparisonRegion: 'Дополнительный',
      aggregates: new Map([['2026-09-01:Дополнительный', observed]]),
    });
    expect(buckets.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: '2026-08-25', to: '2026-08-31' },
      { from: '2026-09-01', to: '2026-09-30' },
      { from: '2026-10-01', to: '2026-10-26' },
    ]);
    expect(buckets.every((bucket) => bucket.main.price === null)).toBe(true);
    expect(buckets[1].comparison).toEqual(observed);
    expect(buckets[0].comparison?.price).toBeNull();
  });

  it('aligns weekly intervals to Monday and leaves an absent comparison absent', () => {
    const buckets = priceBuckets({
      first: '2026-10-21',
      last: '2026-10-27',
      grouping: 'week',
      period: { from: null, to: '2026-10-27' },
      mainRegion: 'Основной',
      aggregates: new Map(),
    });
    expect(buckets.map(({ from }) => from)).toEqual(['2026-10-19', '2026-10-26']);
    expect(buckets.every((bucket) => bucket.comparison === null)).toBe(true);
  });
});
