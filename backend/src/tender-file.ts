import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { parseTenderExcel } from './data/excel.js';
import { TenderRepository } from './repository.js';
import { embeddingProvider } from './embedding.js';

export const fileImportState: {
  stage: string;
  message: string;
  rows?: number;
  imported?: number;
  errors?: unknown[];
  updatedAt?: string;
} = { stage: 'waiting', message: 'Ожидаем data/tenders.xlsx' };
const update = (stage: string, message: string, extra: Partial<typeof fileImportState> = {}) =>
  Object.assign(fileImportState, { stage, message, updatedAt: new Date().toISOString() }, extra);

/** Local input file; idempotent upserts and persisted hashes avoid repeat inference. */
export function watchTenderFile(
  log: (message: string) => void = console.log,
  file = join(config.rootDir, 'data', 'tenders.xlsx'),
) {
  const repository = new TenderRepository();
  let signature = '',
    busy = false,
    stopped = false;
  async function sync() {
    if (busy || stopped) return;
    busy = true;
    try {
      const info = await stat(file).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!info) return;
      const next = `${info.mtimeMs}:${info.size}`;
      if (next === signature) return;
      signature = next;
      update('checking', 'Проверяем data/tenders.xlsx…', { errors: [] });
      log('Найден data/tenders.xlsx. Проверяем и импортируем тендеры…');
      const parsed = await parseTenderExcel(await readFile(file));
      if (parsed.errors.length) {
        update('error', `Excel не импортирован: ошибок ${parsed.errors.length}.`, {
          rows: parsed.totalRows,
          errors: parsed.errors.slice(0, 30),
        });
        log(`Импорт отменён: ${JSON.stringify(parsed.errors)}`);
        return;
      }
      update('importing', `Загружаем ${parsed.tenders.length} тендеров из Excel…`, {
        rows: parsed.totalRows,
      });
      const result = await repository.upsertTenders(parsed.tenders, { removeDemo: true });
      log(`Excel: ${JSON.stringify(result)}. Рассчитываем векторы…`);
      update('indexing', 'Тендеры загружены. Вычисляем векторы…', {
        imported: parsed.tenders.length,
      });
      await repository.index(embeddingProvider, false, (message) => {
        log(message);
        update('indexing', message);
      });
      update(
        'ready',
        `Excel загружен: ${parsed.tenders.length} тендеров. Демонстрационные тендеры удалены.`,
      );
      log('data/tenders.xlsx загружен. Каталог и поиск готовы. Обновите страницу.');
    } catch (error) {
      update('error', error instanceof Error ? error.message : String(error));
      log(
        `Ошибка загрузки tenders.xlsx: ${error instanceof Error ? error.message : String(error)}. Исправьте файл и сохраните повторно либо перезапустите backend.`,
      );
    } finally {
      busy = false;
    }
  }
  void sync();
  const timer = setInterval(() => void sync(), 2000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
