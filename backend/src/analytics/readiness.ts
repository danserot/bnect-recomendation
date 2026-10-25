import type { PoolClient } from 'pg';
import type { PurchaseReadiness } from '@bnect/shared';

/** Only aggregate counts leave this query; no document identifiers, names or prices. */
export async function purchaseReadiness(
  client: PoolClient,
  period: { from: string; to: string },
  now: Date,
): Promise<PurchaseReadiness> {
  const first = new Date(`${period.from}T00:00:00Z`),
    last = new Date(`${period.to}T00:00:00Z`);
  const expectedIntervals =
    (last.getUTCFullYear() - first.getUTCFullYear()) * 12 +
    last.getUTCMonth() -
    first.getUTCMonth() +
    1;
  const {
    rows: [counts],
  } = await client.query(
    `
    WITH eligible AS MATERIALIZED (
      SELECT compatibility_key,region,purchased_on,data->>'number' AS document
      FROM analytics_purchases
      WHERE compatibility_key IS NOT NULL AND region IS NOT NULL AND unit_price>0
    ), grouped AS (
      SELECT compatibility_key,region,count(*) AS rows,count(DISTINCT document) AS documents
      FROM eligible GROUP BY compatibility_key,region
    ), in_period AS MATERIALIZED (
      SELECT * FROM eligible WHERE purchased_on BETWEEN $1::date AND $2::date
    ), bucket_documents AS (
      SELECT compatibility_key,region,date_trunc('month',purchased_on) AS bucket,
        count(DISTINCT document) AS documents,min(document) AS sole_document
      FROM in_period GROUP BY compatibility_key,region,bucket
    ), full_groups AS (
      -- At most one exclusive owner per interval; keep these bounded lists within their group.
      -- Removing a document that solely supplies any month makes its own chart incomplete.
      SELECT compatibility_key,region,
        array_agg(sole_document) FILTER (WHERE documents=1) AS blocked_documents
      FROM bucket_documents
      GROUP BY compatibility_key,region HAVING count(*)=$3
    ), chart_ready_rows AS MATERIALIZED (
      SELECT p.compatibility_key,p.region FROM in_period p
      JOIN full_groups f USING (compatibility_key,region)
      WHERE f.blocked_documents IS NULL OR NOT (p.document=ANY(f.blocked_documents))
    )
    SELECT
      (SELECT count(*)::int FROM analytics_purchases) AS "totalRows",
      (SELECT count(*)::int FROM eligible) AS "eligibleRows",
      (SELECT coalesce(sum(rows),0)::int FROM grouped WHERE documents>1) AS "rowsWithAnalogs",
      (SELECT count(*)::int FROM grouped) AS "comparableGroups",
      (SELECT count(*)::int FROM grouped WHERE documents=1) AS "singleDocumentGroups",
      (SELECT count(*)::int FROM analytics_purchases WHERE purchased_on IS NULL) AS "missingDateRows",
      (SELECT count(*)::int FROM analytics_purchases WHERE unit_price IS NULL OR unit_price<=0) AS "missingPriceRows",
      (SELECT count(*)::int FROM analytics_purchases WHERE purchased_on BETWEEN $1::date AND $2::date) AS "periodRows",
      (SELECT count(*)::int FROM chart_ready_rows) AS "completeChartRows",
      (SELECT count(*)::int FROM (SELECT DISTINCT compatibility_key,region FROM chart_ready_rows) ready_groups) AS "completeChartGroups"
  `,
    [period.from, period.to, expectedIntervals],
  );
  return {
    ...counts,
    generatedAt: now.toISOString(),
    expectedIntervals,
    period: { ...period, grouping: 'month' },
  };
}
