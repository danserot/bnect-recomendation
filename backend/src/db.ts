import pg from 'pg';
import { config } from './config.js';
import { AppError, databaseError } from './errors.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 8,
  connectionTimeoutMillis: 2500,
  idleTimeoutMillis: 30000,
});
pool.on('error', (error) => console.error('PostgreSQL pool:', error.message));

export async function dbQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  values?: unknown[],
): Promise<pg.QueryResult<T>> {
  try {
    return await pool.query<T>(sql, values);
  } catch (error) {
    translateDatabaseError(error);
  }
}

export function translateDatabaseError(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === '42P01' || code === '42703')
    throw new AppError(
      503,
      'DATABASE_NOT_MIGRATED',
      'Схема БД не готова. Выполните npm run db:migrate.',
    );
  if (
    (code &&
      ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '57P01', '28P01', '3D000'].includes(code)) ||
    (error instanceof Error && error.message.includes('timeout'))
  )
    throw databaseError();
  throw error;
}

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE TABLE IF NOT EXISTS tenders (
        id text PRIMARY KEY,
        external_number text NOT NULL UNIQUE,
        title text NOT NULL,
        region_id text,
        created_at timestamptz NOT NULL,
        industry_group text NOT NULL,
        activity text NOT NULL,
        procurement_method text NOT NULL,
        procurement_type text NOT NULL,
        description text,
        status text,
        application_deadline timestamptz,
        source text NOT NULL CHECK (source IN ('import', 'demo')),
        embedding vector(384),
        model_id text,
        embedding_version text,
        content_hash text,
        embedded_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS tenders_region_idx ON tenders(region_id);
      CREATE INDEX IF NOT EXISTS tenders_industry_idx ON tenders(industry_group);
      CREATE TABLE IF NOT EXISTS supplier_profiles (
        id text PRIMARY KEY,
        profile jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS embedding_index_state (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        model_id text NOT NULL,
        embedding_version text NOT NULL,
        dimensions integer NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    // No ANN index: this prototype intentionally uses an exact cosine search.
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
