import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { SEMANTIC_TEXT_VERSION } from './text.js';

function workspaceRoot() {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = path.join(directory, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).workspaces)
      return directory;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Не найден корень npm workspaces.');
    directory = parent;
  }
}
const root = workspaceRoot();
loadEnv({ path: path.join(root, '.env'), quiet: true });

export const config = {
  rootDir: root,
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3001),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgresql://bnect:bnect_local_demo@127.0.0.1:55432/bnect_demo',
  modelId: process.env.EMBEDDING_MODEL ?? 'Xenova/multilingual-e5-small',
  modelRevision: process.env.EMBEDDING_REVISION ?? '761b726',
  dimensions: 384,
  embeddingVersion: `${process.env.EMBEDDING_VERSION ?? 'tender-v1'}:${SEMANTIC_TEXT_VERSION}:e5-query-passage:revision-${process.env.EMBEDDING_REVISION ?? '761b726'}`,
  batchSize: Math.max(1, Math.min(16, Number(process.env.EMBEDDING_BATCH_SIZE ?? 4))),
  cacheDir: path.resolve(root, process.env.MODEL_CACHE_DIR ?? '.cache/models'),
  demoNow: process.env.DEMO_NOW ?? '2026-10-23T09:00:00.000Z',
} as const;

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
  throw new Error('PORT должен быть целым числом от 1 до 65535.');
if (!Number.isInteger(config.batchSize))
  throw new Error('EMBEDDING_BATCH_SIZE должен быть целым числом.');
if (
  process.env.EMBEDDING_DIMENSIONS &&
  Number(process.env.EMBEDDING_DIMENSIONS) !== config.dimensions
)
  throw new Error(
    'Этот прототип использует фиксированную размерность 384. Смена размерности требует миграции vector(384).',
  );
if (!Number.isFinite(Date.parse(config.demoNow)))
  throw new Error('DEMO_NOW должен содержать корректную дату ISO.');
