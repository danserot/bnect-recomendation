import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { Tender } from '@bnect/shared';
import { resolveRegionId } from './regions.js';

export const CSV_HEADERS = [
  '№ тендера',
  'Наименование тендера',
  'Регион',
  'Дата создания',
  'Сфера (группа)',
  'Сфера деятельности',
  'Способ закупки',
  'Вид закупки',
] as const;

export interface CsvRowError {
  row: number;
  field: string;
  message: string;
}
export interface CsvDuplicate {
  externalNumber: string;
  previousRow: number;
  row: number;
  policy: 'last-valid-row-wins';
}
export interface CsvParseResult {
  tenders: Tender[];
  errors: CsvRowError[];
  duplicates: CsvDuplicate[];
  totalRows: number;
}

const requiredText = z
  .string()
  .trim()
  .min(1, 'Поле обязательно.')
  .max(2000, 'Максимум 2000 символов.');
const rowSchema = z.object({
  '№ тендера': requiredText.max(120),
  'Наименование тендера': requiredText,
  Регион: z.string().trim().max(200),
  'Дата создания': requiredText,
  'Сфера (группа)': requiredText,
  'Сфера деятельности': requiredText,
  'Способ закупки': requiredText,
  'Вид закупки': requiredText,
  Описание: z.string().trim().max(20_000).optional(),
  Статус: z.enum(['', 'open', 'closed', 'Открыт', 'Закрыт']).optional(),
  'Срок подачи заявок': z.string().trim().optional(),
});

/** Only unambiguous dates: DD.MM.YYYY, YYYY-MM-DD, or an ISO timestamp with timezone. */
export function parseSourceDate(value: string): string | undefined {
  const text = value.trim();
  let iso: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) iso = `${text}T00:00:00.000Z`;
  else if (/^\d{2}\.\d{2}\.\d{4}$/.test(text)) {
    const [day, month, year] = text.split('.');
    iso = `${year}-${month}-${day}T00:00:00.000Z`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text))
    iso = text;
  else return undefined;

  const [year, month, day] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  )
    return undefined;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

/** Pure CSV adapter; persistence and dry-run belong to the import service. */
export function parseTenderCsv(input: string): CsvParseResult {
  const result: CsvParseResult = { tenders: [], errors: [], duplicates: [], totalRows: 0 };
  let records: { record: string[]; info: { lines: number } }[];
  const firstLine = input.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  // The documented headers never contain either separator. Quoted cell contents are handled by csv-parse.
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  try {
    records = parse(input, {
      bom: true,
      delimiter,
      trim: true,
      skip_empty_lines: true,
      info: true,
      relax_column_count: true,
      max_record_size: 100_000,
    }) as unknown as typeof records;
  } catch (error) {
    const csvError = error as Error & { lines?: number };
    result.errors.push({
      row: csvError.lines ?? 1,
      field: 'CSV',
      message: `Не удалось прочитать CSV: ${csvError.message}`,
    });
    return result;
  }
  const headerRecord = records.shift();
  if (!headerRecord) {
    result.errors.push({ row: 1, field: 'CSV', message: 'CSV пуст. Требуется строка заголовков.' });
    return result;
  }
  const headers = headerRecord.record.map((header) => header.trim());
  const missingHeaders = CSV_HEADERS.filter((header) => !headers.includes(header));
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (missingHeaders.length || duplicateHeaders.length) {
    for (const field of missingHeaders)
      result.errors.push({ row: 1, field, message: 'Отсутствует обязательный заголовок.' });
    for (const field of new Set(duplicateHeaders))
      result.errors.push({ row: 1, field, message: 'Заголовок повторяется.' });
    result.totalRows = records.length;
    return result;
  }
  const validByNumber = new Map<string, { tender: Tender; row: number }>();
  result.totalRows = records.length;
  for (const { record, info } of records) {
    const row = info.lines;
    if (record.length !== headers.length) {
      result.errors.push({
        row,
        field: 'CSV',
        message: `Ожидалось ${headers.length} столбцов, получено ${record.length}.`,
      });
      continue;
    }
    const parsed = rowSchema.safeParse(
      Object.fromEntries(headers.map((header, index) => [header, record[index]])),
    );
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        result.errors.push({ row, field: String(issue.path[0] ?? 'CSV'), message: issue.message });
      continue;
    }
    const source = parsed.data;
    const createdAt = parseSourceDate(source['Дата создания']);
    const applicationDeadline = source['Срок подачи заявок']
      ? parseSourceDate(source['Срок подачи заявок'])
      : undefined;
    if (!createdAt || (source['Срок подачи заявок'] && !applicationDeadline)) {
      if (!createdAt)
        result.errors.push({
          row,
          field: 'Дата создания',
          message: 'Некорректная дата. Допустимы ДД.ММ.ГГГГ, ГГГГ-ММ-ДД или ISO с часовым поясом.',
        });
      if (source['Срок подачи заявок'] && !applicationDeadline)
        result.errors.push({
          row,
          field: 'Срок подачи заявок',
          message: 'Некорректная дата окончания подачи заявок.',
        });
      continue;
    }
    const externalNumber = source['№ тендера'];
    const digest = createHash('sha256').update(`bnect-import:${externalNumber}`).digest('hex');
    const status =
      source['Статус'] === 'open' || source['Статус'] === 'Открыт'
        ? 'open'
        : source['Статус'] === 'closed' || source['Статус'] === 'Закрыт'
          ? 'closed'
          : undefined;
    const tender: Tender = {
      id: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
      externalNumber,
      title: source['Наименование тендера'],
      regionId: resolveRegionId(source['Регион']),
      createdAt,
      industryGroup: source['Сфера (группа)'],
      activity: source['Сфера деятельности'],
      procurementMethod: source['Способ закупки'],
      procurementType: source['Вид закупки'],
      source: 'import',
      ...(source['Описание'] ? { description: source['Описание'] } : {}),
      ...(status ? { status } : {}),
      ...(applicationDeadline ? { applicationDeadline } : {}),
    };
    const previous = validByNumber.get(externalNumber);
    if (previous)
      result.duplicates.push({
        externalNumber,
        previousRow: previous.row,
        row,
        policy: 'last-valid-row-wins',
      });
    validByNumber.set(externalNumber, { tender, row });
  }
  result.tenders = [...validByNumber.values()].map(({ tender }) => tender);
  return result;
}
