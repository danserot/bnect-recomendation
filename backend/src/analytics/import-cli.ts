import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pool } from '../db.js';
import { readLocalPurchases, newLocalReport } from './local-file.js';
import { PurchaseRepository } from './repository.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { config } from '../config.js';

const options = parseArgs({
  allowPositionals: true,
  options: { currency: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
});
try {
  if (
    options.positionals.length !== 1 ||
    !options.values.currency ||
    !/^[A-Z]{3}$/.test(options.values.currency)
  )
    throw new Error(
      'Использование: npm run analytics:import -- data/orders.xlsx --currency KZT [--dry-run]. Валюта должна быть подтверждена владельцем данных.',
    );
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), options.positionals[0]);
  const report = newLocalReport(options.values.currency);
  const records = readLocalPurchases(file, options.values.currency, report);
  let inserted = 0;
  if (options.values['dry-run']) {
    for await (const _record of records) {
      /* Validate without persisting cells. */
    }
  } else inserted = await new PurchaseRepository().importStream(records);
  // Only structural metadata, counts and validation reasons. No rows, prices or parties.
  const result = {
    dryRun: options.values['dry-run'],
    ...report,
    inserted,
    completedAt: new Date().toISOString(),
  };
  const reportPath = resolve(config.rootDir, 'output', 'analytics', 'import-report.json');
  await mkdir(resolve(config.rootDir, 'output', 'analytics'), { recursive: true });
  await writeFile(reportPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(
    JSON.stringify({
      dryRun: result.dryRun,
      read: report.read,
      valid: report.valid,
      skipped: report.skipped,
      issueCount: report.issueCount,
      inserted,
      report: 'output/analytics/import-report.json',
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Не удалось импортировать локальный файл.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
