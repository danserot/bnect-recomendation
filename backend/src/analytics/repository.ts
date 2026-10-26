import type pg from 'pg';
import type {
  PriceAggregate,
  Purchase,
  PurchaseAnalytics,
  PurchaseOptions,
  PurchaseReadiness,
} from '@bnect/shared';
import { pool, translateDatabaseError } from '../db.js';
import { purchaseReadiness } from './readiness.js';
import {
  compatibilityKey,
  comparisonProblem,
  emptyAggregate,
  priceDifference,
  productKey,
} from './domain.js';
import {
  chartGrouping,
  dateBounds,
  priceBuckets,
  type AnalyticsPeriod,
  type DateBounds,
} from './period.js';

export interface AnalyticsQuery {
  q: string;
  product?: string;
  region?: string;
  status?: string;
  period: AnalyticsPeriod;
  page: number;
  pageSize: number;
  selectedId?: string;
  comparisonRegion?: string;
}

interface SqlFilter {
  where: string;
  values: unknown[];
}

interface PurchaseRow {
  data: Purchase;
}

interface RegionAggregateRow extends PriceAggregate {
  region: string;
  undated: number;
}

interface BucketAggregateRow extends PriceAggregate {
  bucket: string;
  region: string;
}

interface ComparisonInput {
  selected: Purchase;
  key: string;
  mainRegion: string;
  comparisonRegion?: string;
  filters: SqlFilter;
  period: DateBounds;
}

type CatalogResult = Pick<PurchaseAnalytics, 'items' | 'total' | 'page' | 'pageSize' | 'selected'>;
type ComparisonResult = Pick<
  PurchaseAnalytics,
  'main' | 'comparison' | 'difference' | 'reason' | 'undated' | 'buckets' | 'period'
>;

const IMPORT_BATCH_SIZE = 500;
const PRODUCT_OPTIONS_LIMIT = 200;
const purchaseFields = [
  'number',
  'title',
  'product',
  'code',
  'characteristics',
  'date',
  'region',
  'quantity',
  'unit',
  'unitPrice',
  'amount',
  'currency',
  'vat',
  'priceKind',
  'status',
] as const satisfies readonly (keyof Purchase)[];
type ObservedField = (typeof purchaseFields)[number];

const aggregateSql = `count(*)::int AS count,
  CASE WHEN count(*)=0 THEN NULL
       WHEN count(quantity)=count(*) THEN (sum(unit_price*quantity)/sum(quantity))::float8
       ELSE avg(unit_price)::float8 END AS price,
  CASE WHEN count(*)>0 AND count(quantity)=count(*) THEN sum(quantity)::float8 ELSE NULL END AS volume,
  CASE WHEN count(*)=0 THEN NULL WHEN count(quantity)=count(*) THEN 'weighted' ELSE 'arithmetic' END AS method`;

async function transaction<T>(
  connection: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
  readOnly = false,
): Promise<T> {
  let client: pg.PoolClient | undefined;
  try {
    client = await connection.connect();
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    return translateDatabaseError(error);
  } finally {
    client?.release();
  }
}

/** Common filters exclude the catalog region so both comparison groups use the same criteria. */
function purchaseFilters(query: AnalyticsQuery, period: DateBounds): SqlFilter {
  const values: unknown[] = [];
  const bind = (value: unknown) => `$${values.push(value)}`;
  const clauses: string[] = [];
  if (query.q)
    clauses.push(
      `strpos(lower(concat_ws(' ',data->>'number',data->>'title',data->>'product',data->>'code')),lower(${bind(query.q)}))>0`,
    );
  if (query.product) clauses.push(`product=${bind(query.product)}`);
  if (query.status) clauses.push(`data->>'status'=${bind(query.status)}`);
  if (period.from)
    clauses.push(`purchased_on BETWEEN ${bind(period.from)}::date AND ${bind(period.to)}::date`);
  return { where: clauses.length ? clauses.join(' AND ') : 'TRUE', values };
}

async function readCatalog(
  client: pg.PoolClient,
  query: AnalyticsQuery,
  filters: SqlFilter,
): Promise<CatalogResult> {
  const values = [...filters.values];
  const where = query.region
    ? `${filters.where} AND region=$${values.push(query.region)}`
    : filters.where;
  const totalResult = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM analytics_purchases WHERE ${where}`,
    values,
  );
  const total = totalResult.rows[0].total;
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
  const list = await client.query<PurchaseRow>(
    `SELECT data FROM analytics_purchases WHERE ${where}
     ORDER BY purchased_on DESC NULLS LAST,id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, query.pageSize, (page - 1) * query.pageSize],
  );
  let selected: Purchase | null = null;
  if (query.selectedId) {
    const result = await client.query<PurchaseRow>(
      `SELECT data FROM analytics_purchases WHERE ${where} AND id=$${values.length + 1}`,
      [...values, query.selectedId],
    );
    selected = result.rows[0]?.data ?? null;
  }
  return {
    items: list.rows.map((row) => row.data),
    total,
    page,
    pageSize: query.pageSize,
    selected,
  };
}

function toAggregate(row: PriceAggregate): PriceAggregate {
  return { price: row.price, count: row.count, volume: row.volume, method: row.method };
}

async function readComparison(
  client: pg.PoolClient,
  input: ComparisonInput,
): Promise<ComparisonResult> {
  const { selected, key, mainRegion, comparisonRegion, filters, period } = input;
  const values = [...filters.values];
  const keyParam = `$${values.push(key)}`;
  const selectedParam = `$${values.push(selected.number)}`;
  const regionsParam = `$${values.push([mainRegion, ...(comparisonRegion ? [comparisonRegion] : [])])}`;
  const eligible = `${filters.where} AND compatibility_key=${keyParam} AND data->>'number'<>${selectedParam} AND region=ANY(${regionsParam}::text[]) AND unit_price>0`;
  const summary = await client.query<RegionAggregateRow>(
    `SELECT region,${aggregateSql},
     count(*) FILTER (WHERE purchased_on IS NULL)::int AS undated
     FROM analytics_purchases WHERE ${eligible} GROUP BY region`,
    values,
  );
  const mainRow = summary.rows.find((row) => row.region === mainRegion);
  const comparisonRow = summary.rows.find((row) => row.region === comparisonRegion);
  const main = mainRow ? toAggregate(mainRow) : emptyAggregate();
  const result: ComparisonResult = {
    main,
    comparison: comparisonRegion
      ? comparisonRow
        ? toAggregate(comparisonRow)
        : emptyAggregate()
      : null,
    undated: summary.rows.reduce((count, row) => count + row.undated, 0),
    difference: priceDifference(selected.unitPrice, main.price),
    reason: main.count ? null : 'Недостаточно данных для сравнения',
    period: { ...period, grouping: 'month' },
    buckets: [],
  };

  const bounds = await client.query<{ first: string | null; last: string | null; count: number }>(
    `SELECT min(purchased_on)::text AS first,max(purchased_on)::text AS last,
     count(purchased_on)::int AS count FROM analytics_purchases WHERE ${eligible}`,
    values,
  );
  const observed = bounds.rows[0];
  const first = [period.from, observed.first, selected.date]
    .filter((date): date is string => !!date)
    .sort()[0];
  const last = period.from
    ? period.to
    : [observed.last, selected.date]
        .filter((date): date is string => !!date)
        .sort()
        .at(-1);
  if (!first || !last) return result;

  const grouping = chartGrouping(first, last, observed.count);
  const buckets = await client.query<BucketAggregateRow>(
    `SELECT date_trunc('${grouping}',purchased_on)::date::text AS bucket,region,${aggregateSql}
     FROM analytics_purchases WHERE ${eligible} AND purchased_on IS NOT NULL
     GROUP BY bucket,region ORDER BY bucket`,
    values,
  );
  result.period.grouping = grouping;
  result.buckets = priceBuckets({
    first,
    last,
    grouping,
    period,
    mainRegion,
    comparisonRegion,
    aggregates: new Map(
      buckets.rows.map((row) => [`${row.bucket}:${row.region}`, toAggregate(row)]),
    ),
  });
  return result;
}

export class PurchaseRepository {
  constructor(private readonly connection = pool) {}

  async readiness(now = new Date()): Promise<PurchaseReadiness> {
    const period = dateBounds('6', now);
    return transaction(
      this.connection,
      (client) => purchaseReadiness(client, { from: period.from!, to: period.to }, now),
      true,
    );
  }

  async import(records: Purchase[]): Promise<number> {
    return this.importStream(records);
  }

  async importStream(records: AsyncIterable<Purchase> | Iterable<Purchase>): Promise<number> {
    return transaction(this.connection, async (client) => {
      let inserted = 0;
      let batch: Purchase[] = [];
      const flush = async () => {
        const entries = batch.map((purchase) => ({
          id: purchase.id,
          data: purchase,
          product: purchase.product,
          region: purchase.region,
          purchased_on: purchase.date,
          product_key: productKey(purchase),
          compatibility_key: compatibilityKey(purchase),
          unit_price: purchase.unitPrice,
          quantity: purchase.quantity,
        }));
        const result = await client.query(
          `INSERT INTO analytics_purchases(id,data,product,region,purchased_on,product_key,compatibility_key,unit_price,quantity)
           SELECT id,data,product,region,purchased_on,product_key,compatibility_key,unit_price,quantity
           FROM jsonb_to_recordset($1::jsonb) AS p(id text,data jsonb,product text,region text,purchased_on date,
             product_key text,compatibility_key text,unit_price numeric,quantity numeric)
           ON CONFLICT (id) DO NOTHING`,
          [JSON.stringify(entries)],
        );
        inserted += result.rowCount ?? 0;
        batch = [];
      };
      for await (const record of records) {
        batch.push(record);
        if (batch.length >= IMPORT_BATCH_SIZE) await flush();
      }
      if (batch.length) await flush();
      return inserted;
    });
  }

  async options(): Promise<PurchaseOptions> {
    return transaction(
      this.connection,
      async (client) => {
        const { rows } = await client.query<
          Pick<PurchaseOptions, 'total' | 'dated' | 'regions' | 'statuses'>
        >(
          `SELECT count(*)::int AS total,count(purchased_on)::int AS dated,
         coalesce(array_agg(DISTINCT region ORDER BY region) FILTER (WHERE region IS NOT NULL),'{}') AS regions,
         coalesce(array_agg(DISTINCT data->>'status' ORDER BY data->>'status') FILTER (WHERE data->>'status' IS NOT NULL),'{}') AS statuses
         FROM analytics_purchases`,
        );
        const fields = await client.query<Record<ObservedField, boolean | null>>(
          `SELECT ${purchaseFields.map((field) => `bool_or(data->>'${field}' IS NOT NULL) AS "${field}"`).join(',')} FROM analytics_purchases`,
        );
        const products = await client.query<{ product: string }>(
          'SELECT DISTINCT product FROM analytics_purchases WHERE product IS NOT NULL ORDER BY product LIMIT $1',
          [PRODUCT_OPTIONS_LIMIT + 1],
        );
        return {
          ...rows[0],
          products: products.rows.slice(0, PRODUCT_OPTIONS_LIMIT).map((row) => row.product),
          productsTruncated: products.rows.length > PRODUCT_OPTIONS_LIMIT,
          fields: purchaseFields.filter((field) => fields.rows[0][field]),
        };
      },
      true,
    );
  }

  async products(search: string): Promise<string[]> {
    return transaction(
      this.connection,
      async (client) => {
        const { rows } = await client.query<{ product: string }>(
          `SELECT DISTINCT product FROM analytics_purchases
         WHERE product IS NOT NULL AND strpos(lower(product),lower($1))>0 ORDER BY product LIMIT 50`,
          [search],
        );
        return rows.map((row) => row.product);
      },
      true,
    );
  }

  async analytics(query: AnalyticsQuery, now = new Date()): Promise<PurchaseAnalytics> {
    return transaction(
      this.connection,
      async (client) => {
        const period = dateBounds(query.period, now);
        const filters = purchaseFilters(query, period);
        const catalog = await readCatalog(client, query, filters);
        const { selected } = catalog;
        const answer: PurchaseAnalytics = {
          ...catalog,
          main: emptyAggregate(),
          comparison: query.comparisonRegion ? emptyAggregate() : null,
          difference: null,
          reason: selected
            ? comparisonProblem(selected)
            : 'Выберите закупку в таблице для сравнения.',
          period: { ...period, grouping: 'month' },
          buckets: [],
          undated: 0,
        };
        if (!selected || answer.reason) return answer;
        if (!query.region) return { ...answer, reason: 'Выберите основной регион для расчёта.' };

        const key = compatibilityKey(selected);
        if (!key) return answer;
        const comparison = await readComparison(client, {
          selected,
          key,
          mainRegion: query.region,
          comparisonRegion: query.comparisonRegion,
          filters,
          period,
        });
        return { ...answer, ...comparison };
      },
      true,
    );
  }
}
