import type {
  Catalog,
  ResolvedFilters,
  SupplierProfile,
  Tender,
  TenderListResponse,
} from '@bnect/shared';
import type pg from 'pg';
import { config } from './config.js';
import { dbQuery, pool, translateDatabaseError } from './db.js';
import { AppError } from './errors.js';
import { regions } from './data/regions.js';
import { projectKey } from './text.js';
import type { EmbeddingProvider } from './embedding.js';
import type { ListQuery } from './validation.js';
import {
  asIso,
  mapTender,
  vectorLiteral,
  type TenderRow,
  type RankedTenderRow,
  type VectorRow,
  type EmbeddingIndexState,
} from './tenders/records.js';
import { upsertTenders, type TenderImportOptions } from './tenders/import.js';
import { indexTenders } from './tenders/index.js';

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
    const rows = await this.query<TenderRow>(
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
    const result = await this.query<TenderRow>('SELECT * FROM tenders WHERE id=$1', [id]);
    if (!result.rowCount) throw new AppError(404, 'TENDER_NOT_FOUND', 'Тендер не найден.');
    return mapTender(result.rows[0]!);
  }

  async catalog(): Promise<Catalog> {
    const { rows } = await this.query<{
      industries: string[];
      activities: string[];
      types: string[];
      methods: string[];
    }>(`SELECT ARRAY(SELECT DISTINCT industry_group FROM tenders ORDER BY industry_group) AS industries,
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
    const { rows } = await this.query<{
      total: number;
      indexed: number;
      pending: number;
    }>(`SELECT count(*)::int total, count(embedding)::int indexed,
      count(*) FILTER (WHERE embedding IS NULL)::int pending FROM tenders`);
    const metadata = await this.query<EmbeddingIndexState>(
      'SELECT * FROM embedding_index_state WHERE singleton=true',
    );
    const state = metadata.rows[0];
    const compatible =
      !state ||
      (state.model_id === config.modelId &&
        state.embedding_version === config.embeddingVersion &&
        state.dimensions === config.dimensions);
    return {
      ...rows[0]!,
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
    const counts = await this.query<{ total: number; candidates: number }>(
      `SELECT count(*)::int total, count(*) FILTER (WHERE ${where})::int candidates FROM tenders`,
      values,
    );
    // PostgreSQL pgvector computes cosine distance in full 384-dimensional space.
    const result = await this.query<RankedTenderRow>(
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
      candidateCount: counts.rows[0]!.candidates,
      totalCount: counts.rows[0]!.total,
    };
  }

  async vectors() {
    const { rows } = await this.query<VectorRow>(
      'SELECT *,embedding::text AS vector_text FROM tenders WHERE embedding IS NOT NULL ORDER BY id',
    );
    return rows.map((row) => ({
      id: row.id,
      tender: mapTender(row),
      vector: JSON.parse(row.vector_text) as number[],
      contentHash: row.content_hash,
      embeddedAt: asIso(row.embedded_at),
    }));
  }

  async upsertTenders(tenders: Tender[], options: TenderImportOptions = {}) {
    return upsertTenders(tenders, options);
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
    return indexTenders(provider, reindex, log);
  }
}
