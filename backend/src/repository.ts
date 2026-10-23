import type {
  Catalog,
  ResolvedFilters,
  SupplierProfile,
  Tender,
  TenderListResponse,
} from '@bnect/shared';
import { isDeepStrictEqual } from 'node:util';
import type pg from 'pg';
import { config } from './config.js';
import { dbQuery, pool, translateDatabaseError } from './db.js';
import { AppError } from './errors.js';
import { regions } from './data/index.js';
import { contentHash, tenderText, projectKey } from './text.js';
import type { EmbeddingProvider } from './embedding.js';
import type { ListQuery } from './validation.js';

type Row = Record<string, any>;
const asIso = (value: Date | string) => new Date(value).toISOString();
export function mapTender(row: Row): Tender {
  return {
    id: row.id,
    externalNumber: row.external_number,
    title: row.title,
    regionId: row.region_id,
    createdAt: asIso(row.created_at),
    industryGroup: row.industry_group,
    activity: row.activity,
    procurementMethod: row.procurement_method,
    procurementType: row.procurement_type,
    ...(row.description ? { description: row.description } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.application_deadline ? { applicationDeadline: asIso(row.application_deadline) } : {}),
    source: row.source,
  };
}

export const vectorLiteral = (vector: number[]): string => {
  if (vector.length !== config.dimensions || !vector.every(Number.isFinite))
    throw new AppError(400, 'INVALID_VECTOR', `Нужен конечный ${config.dimensions}-мерный вектор.`);
  return `[${vector.join(',')}]`;
};

export interface SupplierSourceAdapter {
  list(): Promise<SupplierProfile[]>;
  save(profile: SupplierProfile): Promise<SupplierProfile>;
}

/** Local demo profiles only. A real supplier database integration is intentionally an adapter boundary. */
export class DemoSupplierSourceAdapter implements SupplierSourceAdapter {
  async list(): Promise<SupplierProfile[]> {
    const { rows } = await dbQuery('SELECT profile FROM supplier_profiles ORDER BY id');
    return rows.map((row) => row.profile as SupplierProfile);
  }
  async save(profile: SupplierProfile): Promise<SupplierProfile> {
    const result = await dbQuery(
      'UPDATE supplier_profiles SET profile=$2::jsonb, updated_at=now() WHERE id=$1 RETURNING profile',
      [profile.id, JSON.stringify(profile)],
    );
    if (!result.rowCount)
      throw new AppError(404, 'SUPPLIER_NOT_FOUND', 'Демонстрационный профиль не найден.');
    return result.rows[0]!.profile;
  }
}

export interface SqlConditions {
  clauses: string[];
  values: unknown[];
}
export function buildRecommendationConditions(
  profile: SupplierProfile | undefined,
  filters: ResolvedFilters,
  excludedId?: string,
): SqlConditions {
  const clauses = ['TRUE'];
  const values: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    values.push(value);
    clauses.push(clause.replace('?', `$${values.length}`));
  };
  if (filters.regionMode !== 'all') add('region_id = ANY(?::text[])', filters.regionIds);
  if (filters.industryGroups?.length)
    add('industry_group = ANY(?::text[])', filters.industryGroups);
  if (filters.procurementTypes?.length)
    add('procurement_type = ANY(?::text[])', filters.procurementTypes);
  if (filters.procurementMethods?.length)
    add('procurement_method = ANY(?::text[])', filters.procurementMethods);
  if ((filters.applySupplierIndustryGroups || filters.applySupplierProcurementTypes) && !profile)
    throw new AppError(400, 'PROFILE_REQUIRED', 'Для ограничений поставщика нужен профиль.');
  if (filters.applySupplierIndustryGroups)
    add('industry_group = ANY(?::text[])', profile!.industryGroups);
  if (filters.applySupplierProcurementTypes)
    add('procurement_type = ANY(?::text[])', profile!.procurementTypes);
  if (filters.onlyOpen) {
    clauses.push("status = 'open'");
    add('application_deadline > ?::timestamptz', config.demoNow);
  }
  if (excludedId) add('id <> ?', excludedId);
  return { clauses, values };
}

export const EXACT_SEARCH_SQL = `
-- Eligibility is evaluated in WHERE before the exact cosine sort and LIMIT.
-- No approximate index and no regional bonus are used.
SELECT *, embedding <=> $1::vector AS distance
FROM tenders
WHERE /* structured conditions */ TRUE
ORDER BY distance ASC, id ASC
LIMIT 5;`;

export class TenderRepository {
  constructor(private query: typeof dbQuery = dbQuery) {}

  /** Read one consistent corpus/version across validation, inference, ranking and PCA.
   * Concurrent imports or reindex commits become visible to the next request only. */
  async readSnapshot<T>(work: (repository: TenderRepository) => Promise<T>): Promise<T> {
    let client: pg.PoolClient;
    try {
      client = await pool.connect();
    } catch (error) {
      translateDatabaseError(error);
    }
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshotQuery: typeof dbQuery = async <R extends pg.QueryResultRow = pg.QueryResultRow>(
        sql: string,
        values?: unknown[],
      ) => {
        try {
          return await client.query<R>(sql, values);
        } catch (error) {
          translateDatabaseError(error);
        }
      };
      const result = await work(new TenderRepository(snapshotQuery));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      translateDatabaseError(error);
    } finally {
      client.release();
    }
  }
  async list(query: ListQuery): Promise<TenderListResponse> {
    const values: unknown[] = [];
    const clauses = ['TRUE'];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      clauses.push(sql.replaceAll('?', `$${values.length}`));
    };
    if (query.q)
      add(
        "(title ILIKE ? ESCAPE '\\' OR external_number ILIKE ? ESCAPE '\\')",
        `%${query.q.replace(/[\\%_]/g, '\\$&')}%`,
      );
    if (query.regionId) add('region_id = ?', query.regionId);
    if (query.industryGroup) add('industry_group = ?', query.industryGroup);
    if (query.procurementType) add('procurement_type = ?', query.procurementType);
    if (query.procurementMethod) add('procurement_method = ?', query.procurementMethod);
    const where = clauses.join(' AND ');
    const count = await this.query<{ count: string }>(
      `SELECT count(*) FROM tenders WHERE ${where}`,
      values,
    );
    const rows = await this.query(
      `SELECT * FROM tenders WHERE ${where} ORDER BY created_at DESC,id ASC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      items: rows.rows.map(mapTender),
      total: Number(count.rows[0]!.count),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string): Promise<Tender> {
    const result = await this.query('SELECT * FROM tenders WHERE id=$1', [id]);
    if (!result.rowCount) throw new AppError(404, 'TENDER_NOT_FOUND', 'Тендер не найден.');
    return mapTender(result.rows[0]!);
  }

  async catalog(): Promise<Catalog> {
    const { rows } = await this
      .query(`SELECT ARRAY(SELECT DISTINCT industry_group FROM tenders ORDER BY industry_group) AS industries,
      ARRAY(SELECT DISTINCT activity FROM tenders ORDER BY activity) AS activities,
      ARRAY(SELECT DISTINCT procurement_type FROM tenders ORDER BY procurement_type) AS types,
      ARRAY(SELECT DISTINCT procurement_method FROM tenders ORDER BY procurement_method) AS methods`);
    return {
      regions,
      industryGroups: rows[0]!.industries,
      activities: rows[0]!.activities,
      procurementTypes: rows[0]!.types,
      procurementMethods: rows[0]!.methods,
      demoNow: config.demoNow,
      model: {
        id: config.modelId,
        dimensions: config.dimensions,
        embeddingVersion: config.embeddingVersion,
      },
    };
  }

  async indexStatus() {
    const { rows } = await this.query(`SELECT count(*)::int total, count(embedding)::int indexed,
      count(*) FILTER (WHERE embedding IS NULL)::int pending FROM tenders`);
    const metadata = await this.query('SELECT * FROM embedding_index_state WHERE singleton=true');
    const state = metadata.rows[0];
    const compatible =
      !state ||
      (state.model_id === config.modelId &&
        state.embedding_version === config.embeddingVersion &&
        state.dimensions === config.dimensions);
    return {
      ...(rows[0] as { total: number; indexed: number; pending: number }),
      compatible,
      modelId: state?.model_id,
      embeddingVersion: state?.embedding_version,
    };
  }

  async assertIndexReady(): Promise<void> {
    const status = await this.indexStatus();
    if (!status.compatible)
      throw new AppError(
        409,
        'REINDEX_REQUIRED',
        'Модель или формат embedding изменились. Выполните явную переиндексацию: npm run db:reindex.',
        status,
      );
    if (!status.total)
      throw new AppError(
        409,
        'NO_TENDERS',
        'В БД нет тендеров. Выполните npm run db:seed или импорт CSV.',
      );
    if (status.pending || status.indexed !== status.total)
      throw new AppError(
        409,
        'EMBEDDINGS_MISSING',
        'Часть тендеров ещё не проиндексирована. Выполните npm run db:index; неполная выдача не используется.',
        status,
      );
    const bad = await this.query(
      'SELECT id FROM tenders WHERE embedding IS NOT NULL AND (model_id IS DISTINCT FROM $1 OR embedding_version IS DISTINCT FROM $2) LIMIT 1',
      [config.modelId, config.embeddingVersion],
    );
    if (bad.rowCount)
      throw new AppError(
        409,
        'REINDEX_REQUIRED',
        'Обнаружены несовместимые embedding-метаданные. Выполните npm run db:reindex.',
      );
  }

  async search(
    vector: number[],
    profile: SupplierProfile | undefined,
    filters: ResolvedFilters,
    excludedId?: string,
    diversify = false,
    workActivity?: string,
  ) {
    const { clauses, values } = buildRecommendationConditions(profile, filters, excludedId);
    if (workActivity && !/^[\s—–-]*$/.test(workActivity)) {
      values.push(
        workActivity.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru'),
      );
      clauses.push(
        `lower(regexp_replace(btrim(replace(activity, chr(160), ' ')), '[[:space:]]+', ' ', 'g')) = $${values.length}`,
      );
    }
    const where = clauses.join(' AND ');
    const counts = await this.query(
      `SELECT count(*)::int total, count(*) FILTER (WHERE ${where})::int candidates FROM tenders`,
      values,
    );
    // PostgreSQL pgvector computes cosine distance in full 384-dimensional space.
    const result = await this.query(
      `SELECT id,external_number,title,region_id,created_at,industry_group,activity,procurement_method,procurement_type,description,status,application_deadline,source,content_hash, embedding <=> $${values.length + 1}::vector AS distance
      FROM tenders WHERE ${where} AND embedding IS NOT NULL
      ORDER BY distance ASC, id ASC ${diversify ? '' : 'LIMIT 5'}`,
      [...values, vectorLiteral(vector)],
    );
    const chosen: typeof result.rows = [];
    const seenSubjects = new Set<string>(),
      seenProjects = new Set<string>();
    for (const row of result.rows) {
      const project = projectKey(row.title);
      if (
        diversify &&
        (seenSubjects.has(row.content_hash) || (project && seenProjects.has(project)))
      )
        continue;
      chosen.push(row);
      seenSubjects.add(row.content_hash);
      if (project) seenProjects.add(project);
      if (chosen.length === 5) break;
    }
    return {
      rows: chosen.map((row) => ({
        tender: mapTender(row),
        similarity: 1 - Number(row.distance),
      })),
      candidateCount: counts.rows[0]!.candidates as number,
      totalCount: counts.rows[0]!.total as number,
    };
  }

  async vectors() {
    const { rows } = await this.query(
      'SELECT *,embedding::text AS vector_text FROM tenders WHERE embedding IS NOT NULL ORDER BY id',
    );
    return rows.map((row) => ({
      id: row.id as string,
      tender: mapTender(row),
      vector: JSON.parse(row.vector_text) as number[],
      contentHash: row.content_hash as string,
      embeddedAt: asIso(row.embedded_at),
    }));
  }

  async upsertTenders(
    tenders: Tender[],
    options: { preserveImports?: boolean; dryRun?: boolean; removeDemo?: boolean } = {},
  ) {
    const client = await pool.connect();
    const report = { inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
    try {
      await client.query('BEGIN');
      for (const tender of tenders) {
        const old = await client.query('SELECT * FROM tenders WHERE external_number=$1', [
          tender.externalNumber,
        ]);
        if (options.preserveImports && old.rows[0]?.source === 'import') {
          report.skipped++;
          continue;
        }
        if (
          old.rows[0] &&
          isDeepStrictEqual(
            mapTender(old.rows[0]),
            JSON.parse(
              JSON.stringify({
                ...tender,
                id: old.rows[0].id,
                createdAt: asIso(tender.createdAt),
                ...(tender.applicationDeadline
                  ? { applicationDeadline: asIso(tender.applicationDeadline) }
                  : {}),
              }),
            ),
          )
        ) {
          report.unchanged++;
          continue;
        }
        if (old.rowCount) report.updated++;
        else report.inserted++;
        if (options.dryRun) continue;
        await client.query(
          `INSERT INTO tenders(id,external_number,title,region_id,created_at,industry_group,activity,procurement_method,procurement_type,description,status,application_deadline,source)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT(external_number) DO UPDATE SET title=excluded.title,region_id=excluded.region_id,created_at=excluded.created_at,
          industry_group=excluded.industry_group,activity=excluded.activity,procurement_method=excluded.procurement_method,procurement_type=excluded.procurement_type,
          description=excluded.description,status=excluded.status,application_deadline=excluded.application_deadline,source=excluded.source,
          embedding=CASE WHEN tenders.content_hash=$14 THEN tenders.embedding ELSE NULL END,
          model_id=CASE WHEN tenders.content_hash=$14 THEN tenders.model_id ELSE NULL END,
          embedding_version=CASE WHEN tenders.content_hash=$14 THEN tenders.embedding_version ELSE NULL END,
          embedded_at=CASE WHEN tenders.content_hash=$14 THEN tenders.embedded_at ELSE NULL END,
          content_hash=CASE WHEN tenders.content_hash=$14 THEN tenders.content_hash ELSE NULL END,updated_at=now()`,
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
      }
      if (options.removeDemo && !options.dryRun)
        await client.query("DELETE FROM tenders WHERE source='demo'");
      await client.query(options.dryRun ? 'ROLLBACK' : 'COMMIT');
      return report;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async seedSuppliers(profiles: SupplierProfile[]): Promise<void> {
    for (const profile of profiles)
      await this.query(
        'INSERT INTO supplier_profiles(id,profile) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING',
        [profile.id, JSON.stringify(profile)],
      );
  }

  async index(
    provider: EmbeddingProvider,
    reindex: boolean,
    log: (message: string) => void = console.log,
  ) {
    const client = await pool.connect();
    try {
      const lock = await client.query('SELECT pg_try_advisory_lock(6246127) locked');
      if (!lock.rows[0]?.locked)
        throw new AppError(409, 'INDEX_BUSY', 'Индексация уже запущена другим процессом.');
      const old = await client.query('SELECT * FROM embedding_index_state WHERE singleton=true');
      const state = old.rows[0];
      if (
        !reindex &&
        state &&
        (state.model_id !== config.modelId ||
          state.embedding_version !== config.embeddingVersion ||
          state.dimensions !== config.dimensions)
      )
        throw new AppError(
          409,
          'REINDEX_REQUIRED',
          'Модель или формат текста изменены: используйте npm run db:reindex.',
        );
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM tenders ORDER BY id FOR UPDATE');
      const changed = rows.filter(
        (row) =>
          reindex || !row.embedding || row.content_hash !== contentHash(tenderText(mapTender(row))),
      );
      log(
        `Тендеров: ${rows.length}. Требуется embeddings: ${changed.length}. Неизменившихся: ${rows.length - changed.length}.`,
      );
      // One transaction prevents a failed reindex from exposing mixed vector spaces.
      for (let offset = 0; offset < changed.length; offset += config.batchSize) {
        const batch = changed.slice(offset, offset + config.batchSize);
        const texts = batch.map((row) => tenderText(mapTender(row)));
        const vectors = await provider.embedDocuments(texts);
        for (let i = 0; i < batch.length; i++) {
          await client.query(
            `UPDATE tenders SET embedding=$2::vector,model_id=$3,embedding_version=$4,content_hash=$5,embedded_at=now()
            WHERE id=$1`,
            [
              batch[i]!.id,
              vectorLiteral(vectors[i]!),
              config.modelId,
              config.embeddingVersion,
              contentHash(texts[i]!),
            ],
          );
        }
        log(`Индексация: ${Math.min(offset + batch.length, changed.length)}/${changed.length}`);
      }
      await client.query(
        `INSERT INTO embedding_index_state(singleton,model_id,embedding_version,dimensions) VALUES(true,$1,$2,$3)
        ON CONFLICT(singleton) DO UPDATE SET model_id=excluded.model_id,embedding_version=excluded.embedding_version,dimensions=excluded.dimensions,updated_at=now()`,
        [config.modelId, config.embeddingVersion, config.dimensions],
      );
      await client.query('COMMIT');
      return { indexed: changed.length, unchanged: rows.length - changed.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.query('SELECT pg_advisory_unlock(6246127)').catch(() => undefined);
      client.release();
    }
  }
}
