import type { PriceAggregate, PriceBucket, PurchaseAnalytics } from '@bnect/shared';
import { emptyAggregate } from './domain.js';

export type AnalyticsPeriod = '1' | '3' | '6' | '12' | 'all';
export type DateBounds = Pick<PurchaseAnalytics['period'], 'from' | 'to'>;
export type ChartGrouping = PurchaseAnalytics['period']['grouping'];

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Subtract calendar months in UTC+5, clamping month-end dates rather than overflowing. */
export function dateBounds(period: AnalyticsPeriod, now: Date): DateBounds {
  const to = new Date(now.getTime() + LOCAL_OFFSET_MS).toISOString().slice(0, 10);
  if (period === 'all') return { from: null, to };

  const start = new Date(`${to}T00:00:00Z`);
  const day = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - Number(period));
  const lastDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate();
  start.setUTCDate(Math.min(day, lastDay));
  return { from: start.toISOString().slice(0, 10), to };
}

export function chartGrouping(first: string, last: string, datedRows: number): ChartGrouping {
  const days = (Date.parse(last) - Date.parse(first)) / DAY_MS;
  if (days <= 45 && datedRows < 1000) return 'day';
  return days <= 120 ? 'week' : 'month';
}

interface BucketOptions {
  first: string;
  last: string;
  grouping: ChartGrouping;
  period: DateBounds;
  mainRegion: string;
  comparisonRegion?: string;
  aggregates: ReadonlyMap<string, PriceAggregate>;
}

/** Retain empty intervals so missing observations appear as gaps in the chart. */
export function priceBuckets(options: BucketOptions): PriceBucket[] {
  const { first, last, grouping, period, mainRegion, comparisonRegion, aggregates } = options;
  const cursor = new Date(`${first}T00:00:00Z`);
  if (grouping === 'month') cursor.setUTCDate(1);
  if (grouping === 'week') cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));

  const result: PriceBucket[] = [];
  const endTime = Date.parse(last);
  while (cursor.getTime() <= endTime) {
    const from = cursor.toISOString().slice(0, 10);
    if (grouping === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + (grouping === 'week' ? 7 : 1));
    const to = new Date(cursor.getTime() - DAY_MS).toISOString().slice(0, 10);
    result.push({
      from: period.from && from < period.from ? period.from : from,
      to: period.from && to > period.to ? period.to : to,
      main: aggregates.get(`${from}:${mainRegion}`) ?? emptyAggregate(),
      comparison: comparisonRegion
        ? (aggregates.get(`${from}:${comparisonRegion}`) ?? emptyAggregate())
        : null,
    });
  }
  return result;
}
