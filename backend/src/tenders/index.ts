import { config } from '../config.js';
import { pool } from '../db.js';
import { AppError } from '../errors.js';
import { contentHash, tenderText } from '../text.js';
import type { EmbeddingProvider } from '../embedding.js';
import {
  mapTender,
  vectorLiteral,
  type IndexedTenderRow,
  type EmbeddingIndexState,
} from './records.js';

export async function indexTenders(
  provider: EmbeddingProvider,
  reindex: boolean,
  log: (message: string) => void = console.log,
) {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(6246127) locked',
    );
    if (!lock.rows[0]?.locked)
      throw new AppError(409, 'INDEX_BUSY', 'Индексация уже запущена другим процессом.');
    const old = await client.query<EmbeddingIndexState>(
      'SELECT * FROM embedding_index_state WHERE singleton=true',
    );
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
    const { rows } = await client.query<IndexedTenderRow>(
      'SELECT * FROM tenders ORDER BY id FOR UPDATE',
    );
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
