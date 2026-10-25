import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { stat } from 'node:fs/promises';
import type { Purchase } from '@bnect/shared';
import { parseDate, parseNumber } from './import.js';
import { normalize, purchaseId } from './domain.js';
import { regions } from '../data/regions.js';
import { AppError } from '../errors.js';

export interface LocalFileReport {
  sheets: {
    index: number;
    rows: number;
    kind: 'orders' | 'requests' | 'skipped';
    headers: string[];
  }[];
  read: number;
  valid: number;
  skipped: number;
  issues: { sheet: number; row: number; reason: string }[];
  issueCount: number;
  currency: string;
  currencyBasis: 'user-confirmed';
}

/** Streaming adapter for the supplied orders export. Never logs cell values or suppliers. */
export async function* readLocalPurchases(
  file: string,
  currency: string,
  report: LocalFileReport,
): AsyncGenerator<Purchase> {
  const info = await stat(file);
  if (!info.isFile() || info.size > 100 * 1024 * 1024 || !/\.xlsx$/i.test(file))
    throw new AppError(400, 'LOCAL_FILE_LIMIT', 'Нужен локальный .xlsx до 100 МБ.');
  async function* worksheets(): AsyncGenerator<{ name: string; rows: AsyncIterable<ExcelJS.Row> }> {
    if (info.size <= 5 * 1024 * 1024) {
      // The document reader also supports small workbooks whose ZIP entries are in arbitrary order.
      const book = new ExcelJS.Workbook();
      await book.xlsx.readFile(file);
      for (const sheet of book.worksheets) {
        async function* rows() {
          for (let i = 1; i <= sheet.rowCount; i++) yield sheet.getRow(i);
        }
        yield { name: sheet.name, rows: rows() };
      }
    } else {
      const book = new ExcelJS.stream.xlsx.WorkbookReader(file, {
        worksheets: 'emit',
        sharedStrings: 'cache',
        styles: 'cache',
        hyperlinks: 'ignore',
      });
      for await (const sheet of book)
        yield { name: (sheet as unknown as { name?: string }).name ?? 'Лист', rows: sheet };
    }
  }
  let sheetIndex = 0;
  for await (const sheet of worksheets()) {
    sheetIndex++;
    let headers: string[] = [];
    let kind: 'orders' | 'requests' | 'skipped' = 'skipped';
    const sheetReport: LocalFileReport['sheets'][number] = {
      index: sheetIndex,
      rows: 0,
      kind,
      headers,
    };
    report.sheets.push(sheetReport);
    for await (const row of sheet.rows) {
      if (row.number === 1) {
        headers = Array.from({ length: row.cellCount }, (_, i) => row.getCell(i + 1).text.trim());
        kind = headers.includes('№ заказа')
          ? 'orders'
          : headers.includes('№ запроса')
            ? 'requests'
            : 'skipped';
        sheetReport.kind = kind;
        sheetReport.headers = kind === 'skipped' ? [] : headers;
        continue;
      }
      if (!row.hasValues) continue;
      sheetReport.rows++;
      if (kind === 'skipped') continue;
      report.read++;
      if (report.read > 1_000_000)
        throw new AppError(400, 'ROW_LIMIT', 'Лимит локального импорта — 1 млн строк.');
      const get = (name: string) => {
        const index = headers.indexOf(name);
        return index < 0 ? null : row.getCell(index + 1);
      };
      const text = (name: string) => get(name)?.text.trim() || null;
      const number = (name: string) => parseNumber(get(name)?.value);
      const issue = (reason: string) => {
        report.issueCount++;
        if (report.issues.length < 100)
          report.issues.push({ sheet: sheetIndex, row: row.number, reason });
      };
      const externalNumber = text(kind === 'orders' ? '№ заказа' : '№ запроса');
      const product = text('Наименование номенклатуры'),
        code = text('Код номенклатуры');
      const dateCell = get(kind === 'orders' ? 'Дата заказа' : 'Дата запроса');
      const date = parseDate(dateCell?.value);
      const quantity = number(kind === 'orders' ? 'Количество' : 'Кол-во предложено');
      const unitPrice = number('Цена без НДС');
      const amount = number('Сумма с НДС');
      const unit = text('Ед. изм.');
      const rowStatus = text(kind === 'orders' ? 'Статус заказа' : 'Статус запроса');
      const sourceStatus =
        kind === 'requests'
          ? [rowStatus, text('Статус ответа поставщика'), text('Позиция принята')]
              .filter(Boolean)
              .join(' / ')
          : rowStatus;
      const invalidCell = headers.some((_, i) =>
        [ExcelJS.ValueType.Formula, ExcelJS.ValueType.Error].includes(row.getCell(i + 1).type),
      );
      let invalid = false;
      if (invalidCell) {
        issue('Формула или ошибка Excel: нужны значения.');
        invalid = true;
      }
      if (!externalNumber || !product) {
        issue('Отсутствует номер документа или номенклатура.');
        invalid = true;
      }
      if (date === 'invalid') {
        issue('Некорректная дата.');
        invalid = true;
      }
      if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice <= 0)) {
        issue('Неположительная или некорректная цена без НДС.');
        invalid = true;
      }
      if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
        issue('Неположительное или некорректное количество.');
        invalid = true;
      }
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        issue('Отрицательная или некорректная сумма с НДС.');
        invalid = true;
      }
      if (invalid) {
        report.skipped++;
        continue;
      }
      const regionText = text('Регион');
      const region =
        regions.find((r) =>
          [r.name, ...r.aliases].some((a) => normalize(a) === normalize(regionText ?? '')),
        )?.name ?? regionText;
      const data: Omit<Purchase, 'id'> = {
        number: externalNumber!,
        title: product!,
        product,
        code,
        characteristics: null,
        comparisonGroup: null,
        date,
        region,
        quantity,
        unit: unit ? normalize(unit).replace(/^шт\.$/, 'шт') : null,
        unitPrice,
        amount,
        currency,
        vat: 'без НДС',
        amountVat: 'с НДС',
        priceKind: sourceStatus
          ? `${kind === 'orders' ? 'цена заказа' : 'предложение по запросу'}: ${sourceStatus}`
          : null,
        status: sourceStatus || null,
        priceDerived: false,
        identityKind: 'nomenclature',
        // Supplier and project identifiers are used only for an opaque deduplication key.
        sourceIdentity: createHash('sha256')
          .update(
            JSON.stringify([kind, externalNumber, code, text('GUID поставщика'), text('Проект')]),
          )
          .digest('hex'),
        source: {
          file: basename(file),
          sheet: sheet.name,
          row: row.number,
          currencyBasis: 'user-confirmed',
        },
      };
      report.valid++;
      yield { id: purchaseId(data), ...data };
    }
  }
}

export const newLocalReport = (currency: string): LocalFileReport => ({
  sheets: [],
  read: 0,
  valid: 0,
  skipped: 0,
  issues: [],
  issueCount: 0,
  currency,
  currencyBasis: 'user-confirmed',
});
