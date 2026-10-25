import type pg from 'pg';
import type {
  PriceAggregate,
  Purchase,
  PurchaseAnalytics,
  PurchaseOptions,
  PurchaseReadiness,
} from '@bnect/shared';
import { purchaseReadiness } from './readiness.js';
import { pool, translateDatabaseError } from '../db.js';
import {
  compatibilityKey,
  comparisonProblem,
  emptyAggregate,
  priceDifference,
  productKey,
} from './domain.js';

export interface AnalyticsQuery {
  q: string;
  product?: string;
  region?: string;
  status?: string;
  period: '1' | '3' | '6' | '12' | 'all';
  page: number;
  pageSize: number;
  selectedId?: string;
  comparisonRegion?: string;
}

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

const aggregateSql = `count(*)::int AS count,
  CASE WHEN count(*)=0 THEN NULL
       WHEN count(quantity)=count(*) THEN (sum(unit_price*quantity)/sum(quantity))::float8
       ELSE avg(unit_price)::float8 END AS price,
  CASE WHEN count(*)>0 AND count(quantity)=count(*) THEN sum(quantity)::float8 ELSE NULL END AS volume,
  CASE WHEN count(*)=0 THEN NULL WHEN count(quantity)=count(*) THEN 'weighted' ELSE 'arithmetic' END AS method`;

function dateBounds(period: AnalyticsQuery['period'], now: Date) {
  const to = new Date(now.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  if (period === 'all') return { from: null, to };
  const end = new Date(`${to}T00:00:00Z`);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() - Number(period));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return { from: end.toISOString().slice(0, 10), to };
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
    async function* source() {
      yield* records;
    }
    return this.importStream(source());
  }

  async importStream(records: AsyncIterable<Purchase>): Promise<number> {
    return transaction(this.connection, async (client) => {
      let inserted = 0;
      let batch: Purchase[] = [];
      const flush = async () => {
        const entries = batch.map((p) => ({
          id: p.id,
          data: p,
          product: p.product,
          region: p.region,
          purchased_on: p.date,
          product_key: productKey(p),
          compatibility_key: compatibilityKey(p),
          unit_price: p.unitPrice,
          quantity: p.quantity,
        }));
        const result = await client.query(
          `
          INSERT INTO analytics_purchases(id,data,product,region,purchased_on,product_key,compatibility_key,unit_price,quantity)
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
        if (batch.length >= 500) await flush();
      }
      if (batch.length) await flush();
      return inserted;
    });
  }

  async options(): Promise<PurchaseOptions> {
    return transaction(
      this.connection,
      async (client) => {
        const { rows } = await client.query(`SELECT count(*)::int AS total,
        count(purchased_on)::int AS dated,
        coalesce(array_agg(DISTINCT region ORDER BY region) FILTER (WHERE region IS NOT NULL),'{}') AS regions,
        coalesce(array_agg(DISTINCT data->>'status' ORDER BY data->>'status') FILTER (WHERE data->>'status' IS NOT NULL),'{}') AS statuses
        FROM analytics_purchases`);
        const keys = [
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
        ];
        const fields = await client.query(
          `SELECT ${keys.map((key) => `bool_or(data->>'${key}' IS NOT NULL) AS "${key}"`).join(',')} FROM analytics_purchases`,
        );
        const products = await client.query(
          'SELECT DISTINCT product FROM analytics_purchases WHERE product IS NOT NULL ORDER BY product LIMIT 201',
        );
        return {
          ...rows[0],
          products: products.rows.slice(0, 200).map((r) => r.product),
          productsTruncated: products.rows.length > 200,
          fields: keys.filter((key) => fields.rows[0][key]),
        };
      },
      true,
    );
  }

  async products(search: string): Promise<string[]> {
    return transaction(
      this.connection,
      async (client) => {
        const { rows } = await client.query(
          `SELECT DISTINCT product FROM analytics_purchases
        WHERE product IS NOT NULL AND strpos(lower(product),lower($1))>0 ORDER BY product LIMIT 50`,
          [search],
        );
        return rows.map((r) => r.product);
      },
      true,
    );
  }

  async analytics(query: AnalyticsQuery, now = new Date()): Promise<PurchaseAnalytics> {
    return transaction(
      this.connection,
      async (client) => {
        const period = dateBounds(query.period, now);
        const params: unknown[] = [];
        const bind = (value: unknown) => {
          params.push(value);
          return `$${params.length}`;
        };
        const filters: string[] = [];
        if (query.q)
          filters.push(
            `strpos(lower(concat_ws(' ',data->>'number',data->>'title',data->>'product',data->>'code')),lower(${bind(query.q)}))>0`,
          );
        if (query.product) filters.push(`product=${bind(query.product)}`);
        if (query.status) filters.push(`data->>'status'=${bind(query.status)}`);
        if (period.from)
          filters.push(
            `purchased_on BETWEEN ${bind(period.from)}::date AND ${bind(period.to)}::date`,
          );
        const base = filters.length ? filters.join(' AND ') : 'TRUE';
        const catalogWhere = query.region ? `${base} AND region=${bind(query.region)}` : base;
        const totalResult = await client.query(
          `SELECT count(*)::int AS total FROM analytics_purchases WHERE ${catalogWhere}`,
          params,
        );
        const total = totalResult.rows[0].total as number;
        const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
        const listParams = [...params, query.pageSize, (page - 1) * query.pageSize];
        const list = await client.query(
          `SELECT data FROM analytics_purchases WHERE ${catalogWhere}
        ORDER BY purchased_on DESC NULLS LAST,id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          listParams,
        );
        let selected: Purchase | null = null;
        if (query.selectedId) {
          const result = await client.query(
            `SELECT data FROM analytics_purchases WHERE ${catalogWhere} AND id=$${params.length + 1}`,
            [...params, query.selectedId],
          );
          selected = result.rows[0]?.data ?? null;
        }
        const answer: PurchaseAnalytics = {
          items: list.rows.map((r) => r.data),
          total,
          page,
          pageSize: query.pageSize,
          selected,
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
        if (!query.region) {
          answer.reason = 'Выберите основной регион для расчёта.';
          return answer;
        }
        const key = compatibilityKey(selected)!;
        // Remove the catalog-only region parameter. The same base filters apply to both groups.
        const groupParams = query.region ? params.slice(0, -1) : [...params];
        const keyParam = `$${groupParams.push(key)}`;
        const selectedParam = `$${groupParams.push(selected.number)}`;
        const regionsParam = `$${groupParams.push([query.region, ...(query.comparisonRegion ? [query.comparisonRegion] : [])])}`;
        const eligible = `${base} AND compatibility_key=${keyParam} AND data->>'number'<>${selectedParam} AND region=ANY(${regionsParam}::text[]) AND unit_price>0`;
        const summary = await client.query(
          `SELECT region,${aggregateSql},
        count(*) FILTER (WHERE purchased_on IS NULL)::int AS undated
        FROM analytics_purchases WHERE ${eligible} GROUP BY region`,
          groupParams,
        );
        const main = summary.rows.find((r) => r.region === query.region);
        const comparison = summary.rows.find((r) => r.region === query.comparisonRegion);
        answer.main = main ? toAggregate(main) : emptyAggregate();
        answer.comparison = query.comparisonRegion
          ? comparison
            ? toAggregate(comparison)
            : emptyAggregate()
          : null;
        answer.undated = summary.rows.reduce((n, r) => n + r.undated, 0);
        answer.difference = priceDifference(selected.unitPrice, answer.main.price);
        answer.reason = answer.main.count ? null : 'Недостаточно данных для сравнения';
        const bounds = await client.query(
          `SELECT min(purchased_on)::text AS first,max(purchased_on)::text AS last,
        count(purchased_on)::int AS count FROM analytics_purchases WHERE ${eligible}`,
          groupParams,
        );
        const first = [period.from, bounds.rows[0].first, selected.date]
          .filter((d): d is string => !!d)
          .sort()[0];
        const last = period.from
          ? period.to
          : [bounds.rows[0].last, selected.date]
              .filter((d): d is string => !!d)
              .sort()
              .at(-1);
        if (!first || !last) return answer;
        const days = (Date.parse(last) - Date.parse(first)) / 86400000;
        const grouping =
          days <= 45 && bounds.rows[0].count < 1000 ? 'day' : days <= 120 ? 'week' : 'month';
        answer.period.grouping = grouping;
        const buckets = await client.query(
          `SELECT date_trunc('${grouping}',purchased_on)::date::text AS bucket,region,${aggregateSql}
        FROM analytics_purchases WHERE ${eligible} AND purchased_on IS NOT NULL
        GROUP BY bucket,region ORDER BY bucket`,
          groupParams,
        );
        const byKey = new Map(buckets.rows.map((r) => [`${r.bucket}:${r.region}`, toAggregate(r)]));
        const cursor = new Date(`${first}T00:00:00Z`);
        if (grouping === 'month') cursor.setUTCDate(1);
        if (grouping === 'week')
          cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
        while (cursor.getTime() <= Date.parse(last)) {
          const from = cursor.toISOString().slice(0, 10);
          if (grouping === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
          else cursor.setUTCDate(cursor.getUTCDate() + (grouping === 'week' ? 7 : 1));
          const to = new Date(cursor.getTime() - 86400000).toISOString().slice(0, 10);
          answer.buckets.push({
            from: period.from && from < period.from ? period.from : from,
            to: period.from && to > period.to ? period.to : to,
            main: byKey.get(`${from}:${query.region}`) ?? emptyAggregate(),
            comparison: query.comparisonRegion
              ? (byKey.get(`${from}:${query.comparisonRegion}`) ?? emptyAggregate())
              : null,
          });
        }
        return answer;
      },
      true,
    );
  }
}

function toAggregate(row: pg.QueryResultRow): PriceAggregate {
  return { price: row.price, count: row.count, volume: row.volume, method: row.method };
}
