import { isDeepStrictEqual } from 'node:util';
import type { Tender } from '@bnect/shared';
import { pool } from '../db.js';
import { contentHash, tenderText } from '../text.js';
import { asIso, mapTender, type TenderRow } from './records.js';

export interface TenderImportOptions {
  preserveImports?: boolean;
  dryRun?: boolean;
  removeDemo?: boolean;
}

const TENDER_COLUMNS = `
  id, external_number, title, region_id, created_at, industry_group, activity,
  procurement_method, procurement_type, description, status, application_deadline, source
`;

function normalizeIncomingTender(tender: Tender, existingId: string): Tender {
  return JSON.parse(
    JSON.stringify({
      ...tender,
      id: existingId,
      createdAt: asIso(tender.createdAt),
      ...(tender.applicationDeadline
        ? { applicationDeadline: asIso(tender.applicationDeadline) }
        : {}),
    }),
  ) as Tender;
}

/** Preload the existing batch once, keeping unchanged imports free of per-row lookups. */
export async function upsertTenders(tenders: Tender[], options: TenderImportOptions = {}) {
  const client = await pool.connect();
  const report = { inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<TenderRow>(
      `SELECT ${TENDER_COLUMNS} FROM tenders WHERE external_number = ANY($1::text[])`,
      [tenders.map((tender) => tender.externalNumber)],
    );
    const existingByNumber = new Map(rows.map((row) => [row.external_number, mapTender(row)]));
    for (const tender of tenders) {
      const existing = existingByNumber.get(tender.externalNumber);
      if (options.preserveImports && existing?.source === 'import') {
        report.skipped++;
        continue;
      }
      if (existing && isDeepStrictEqual(existing, normalizeIncomingTender(tender, existing.id))) {
        report.unchanged++;
        continue;
      }
      if (existing) report.updated++;
      else report.inserted++;
      if (options.dryRun) continue;
      const result = await client.query<TenderRow>(
        `INSERT INTO tenders(${TENDER_COLUMNS})
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(external_number) DO UPDATE SET title=excluded.title,region_id=excluded.region_id,created_at=excluded.created_at,
        industry_group=excluded.industry_group,activity=excluded.activity,procurement_method=excluded.procurement_method,procurement_type=excluded.procurement_type,
        description=excluded.description,status=excluded.status,application_deadline=excluded.application_deadline,source=excluded.source,
        embedding=CASE WHEN tenders.content_hash=$14 THEN tenders.embedding ELSE NULL END,
        model_id=CASE WHEN tenders.content_hash=$14 THEN tenders.model_id ELSE NULL END,
        embedding_version=CASE WHEN tenders.content_hash=$14 THEN tenders.embedding_version ELSE NULL END,
        embedded_at=CASE WHEN tenders.content_hash=$14 THEN tenders.embedded_at ELSE NULL END,
        content_hash=CASE WHEN tenders.content_hash=$14 THEN tenders.content_hash ELSE NULL END,updated_at=now()
        RETURNING ${TENDER_COLUMNS}`,
        [
          tender.id,
          tender.externalNumber,
          tender.title,
          tender.regionId,
          tender.createdAt,
          tender.industryGroup,
          tender.activity,
          tender.procurementMethod,
          tender.procurementType,
          tender.description ?? null,
          tender.status ?? null,
          tender.applicationDeadline ?? null,
          tender.source,
          contentHash(tenderText(tender)),
        ],
      );
      // Later occurrences of the same number observe this write, just as a new SELECT would.
      existingByNumber.set(tender.externalNumber, mapTender(result.rows[0]!));
    }
    if (options.removeDemo && !options.dryRun)
      await client.query("DELETE FROM tenders WHERE source='demo'");
    await client.query(options.dryRun ? 'ROLLBACK' : 'COMMIT');
    return report;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
