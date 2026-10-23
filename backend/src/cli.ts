import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { migrate, pool } from './db.js';
import { demoSuppliers, generateDemoTenders, parseTenderCsv } from './data/index.js';
import { embeddingProvider } from './embedding.js';
import { AppError } from './errors.js';
import { TenderRepository } from './repository.js';

const [command, ...arguments_] = process.argv.slice(2);
const repository = new TenderRepository();
try {
  if (command === 'migrate') {
    await migrate();
    console.log('Схема PostgreSQL + pgvector готова.');
  } else if (command === 'seed') {
    const result = await repository.upsertTenders(generateDemoTenders(), { preserveImports: true });
    await repository.seedSuppliers(demoSuppliers);
    console.log(
      JSON.stringify(
        {
          source: 'demo',
          ...result,
          message: 'Демонстрационные данные сохранены. Существующие профили не перезаписаны.',
        },
        null,
        2,
      ),
    );
  } else if (command === 'index' || command === 'reindex') {
    console.log(
      JSON.stringify(await repository.index(embeddingProvider, command === 'reindex'), null, 2),
    );
  } else if (command === 'import') {
    const options = parseArgs({
      args: arguments_.filter((value) => value !== '--'),
      allowPositionals: true,
      options: { 'dry-run': { type: 'boolean', default: false } },
    });
    const dryRun = options.values['dry-run'] || process.env.npm_config_dry_run === 'true';
    const path = options.positionals[0];
    if (!path || options.positionals.length !== 1)
      throw new AppError(
        400,
        'CSV_PATH_REQUIRED',
        'Использование: npm run db:import -- путь/тендеры.csv [--dry-run]',
      );
    // npm workspaces executes this script in backend/, while user paths are relative
    // to the directory where npm was invoked.
    const inputPath = resolve(process.env.INIT_CWD ?? process.cwd(), path);
    const parsed = parseTenderCsv(await readFile(inputPath, 'utf8'));
    console.log(
      JSON.stringify(
        {
          dryRun,
          totalRows: parsed.totalRows,
          validRows: parsed.tenders.length,
          errors: parsed.errors,
          duplicates: parsed.duplicates,
        },
        null,
        2,
      ),
    );
    if (parsed.errors.length)
      throw new AppError(
        400,
        'CSV_INVALID',
        'Импорт отменён: исправьте ошибки CSV. Записи в БД не изменены.',
      );
    const result = await repository.upsertTenders(parsed.tenders, { dryRun });
    console.log(JSON.stringify(result, null, 2));
  } else
    throw new AppError(
      400,
      'UNKNOWN_COMMAND',
      'Команды: migrate, seed, index, reindex, import путь.csv [--dry-run]',
    );
} catch (error) {
  console.error(
    error instanceof AppError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
