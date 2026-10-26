import ExcelJS from 'exceljs';
import type { Purchase, PurchaseImportReport } from '@bnect/shared';
import { AppError } from '../errors.js';
import { normalize, purchaseId } from './domain.js';
import { canonicalRegion, parseDate, parseNumber } from './values.js';

export { parseDate, parseNumber } from './values.js';

const aliases: Record<string, string[]> = {
  number: ['номер', 'номер закупки', '№ закупки', '№ тендера', 'номер тендера'],
  title: ['наименование', 'название закупки', 'наименование закупки', 'наименование тендера'],
  product: ['товар', 'наименование товара'],
  code: ['код', 'код товара', 'артикул'],
  characteristics: ['характеристики', 'характеристики товара', 'спецификация'],
  comparisonGroup: ['группа сравнения', 'подтвержденная группа сравнения'],
  date: ['дата', 'дата закупки', 'дата создания'],
  region: ['регион'],
  quantity: ['количество', 'объем', 'объём'],
  unit: ['единица', 'единица измерения', 'ед. изм.', 'ед. изм'],
  unitPrice: ['цена за единицу', 'цена за ед.', 'цена за единицу товара'],
  amount: ['сумма', 'общая сумма', 'сумма закупки', 'стоимость лота'],
  currency: ['валюта'],
  vat: ['ндс', 'режим ндс'],
  priceKind: ['вид цены', 'тип цены'],
  status: ['статус'],
};
const headerField = (header: string) =>
  Object.entries(aliases).find(([, names]) =>
    names.includes(normalize(header).replaceAll('ё', 'е')),
  )?.[0] ?? null;

function canonical(field: string, text: string | null): string | null {
  if (!text) return null;
  const key = normalize(text);
  if (field === 'region') return canonicalRegion(text);
  if (field === 'currency')
    return { '₸': 'KZT', тг: 'KZT', тенге: 'KZT' }[key] ?? text.toUpperCase();
  if (field === 'unit') return { 'шт.': 'шт', штука: 'шт', штук: 'шт', 'кг.': 'кг' }[key] ?? key;
  if (field === 'priceKind') return { план: 'плановая', факт: 'фактическая' }[key] ?? key;
  return field === 'vat' ? key : text;
}

export async function parsePurchaseExcel(buffer: Buffer, file: string, sheetName?: string) {
  if (!buffer.length || buffer.length > 5 * 1024 * 1024)
    throw new AppError(400, 'FILE_SIZE', 'Выберите непустой .xlsx размером до 5 МБ.');
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as never);
  } catch {
    throw new AppError(
      400,
      'INVALID_EXCEL',
      'Не удалось прочитать .xlsx. Проверьте формат и пароль.',
    );
  }
  const sheet = sheetName ? book.getWorksheet(sheetName) : book.worksheets[0];
  if (!sheet) throw new AppError(400, 'SHEET_REQUIRED', 'В файле нет выбранного листа.');
  if (sheet.rowCount > 50001 || sheet.columnCount > 64)
    throw new AppError(400, 'EXCEL_LIMIT', 'Допускается до 50000 строк и 64 столбцов на листе.');
  const headers = Array.from({ length: sheet.columnCount }, (_, i) =>
    sheet
      .getRow(1)
      .getCell(i + 1)
      .text.trim(),
  );
  const fields = headers.map(headerField);
  const duplicates = fields.filter((f, i) => f && fields.indexOf(f) !== i);
  if (duplicates.length)
    throw new AppError(
      400,
      'DUPLICATE_HEADERS',
      'Несколько столбцов обозначают одно поле. Уточните заголовки.',
    );
  const report: PurchaseImportReport = {
    sheets: book.worksheets.map((s) => ({
      name: s.name,
      rows: Math.max(0, s.rowCount - 1),
      headers: Array.from(
        { length: Math.min(s.columnCount, 64) },
        (_, i) => s.getRow(1).getCell(i + 1).text,
      ),
    })),
    sheet: sheet.name,
    columns: headers.map((header, i) => ({ header, field: fields[i], types: [] })),
    sample: [],
    totalRows: 0,
    validRows: 0,
    skippedRows: 0,
    duplicates: 0,
    issues: [],
    issueCount: 0,
    fields: fields.filter((f): f is string => !!f),
    imported: false,
  };
  const records: Purchase[] = [];
  const seen = new Set<string>();
  const issue = (row: number, message: string) => {
    report.issueCount++;
    if (report.issues.length < 100) report.issues.push({ row, message });
  };
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (!row.hasValues) continue;
    report.totalRows++;
    const values: Record<string, unknown> = {};
    const sample: Record<string, string> = {};
    let invalid = false;
    headers.forEach((header, i) => {
      const cell = row.getCell(i + 1);
      if (report.sample.length < 3) sample[header || `Столбец ${i + 1}`] = cell.text.slice(0, 300);
      const type = cell.value instanceof Date ? 'date' : ExcelJS.ValueType[cell.type];
      if (report.columns[i].types.length < 8 && !report.columns[i].types.includes(type))
        report.columns[i].types.push(type);
      const field = fields[i];
      if (!field) return;
      if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error) {
        invalid = true;
        issue(r, `${header}: замените формулу/ошибку значением.`);
        return;
      }
      values[field] =
        cell.value instanceof Date || typeof cell.value === 'number'
          ? cell.value
          : cell.text.trim();
    });
    if (report.sample.length < 3) report.sample.push(sample);
    const text = (field: string) => {
      const value = values[field];
      const result = value === undefined || value === null ? null : String(value).trim() || null;
      if (result && result.length > 4000) {
        invalid = true;
        issue(r, `${field}: значение длиннее 4000 символов.`);
      }
      return canonical(field, result);
    };
    const number = text('number'),
      title = text('title');
    if (!number || !title) {
      invalid = true;
      issue(r, 'Нужны номер и наименование закупки.');
    }
    const numeric: Record<string, number | null> = {};
    for (const field of ['quantity', 'unitPrice', 'amount']) {
      const value = parseNumber(values[field]);
      numeric[field] = value;
      if (value !== null && (!Number.isFinite(value) || value <= 0)) {
        invalid = true;
        issue(r, `${headers[fields.indexOf(field)]}: нужно положительное число.`);
      }
    }
    const date = parseDate(values.date, book.properties.date1904);
    if (date === 'invalid') {
      invalid = true;
      issue(r, 'Дата некорректна. Используйте дату Excel, ДД.ММ.ГГГГ или ГГГГ-ММ-ДД.');
    }
    const priceDerived =
      numeric.unitPrice === null && numeric.amount !== null && numeric.quantity !== null;
    const price = priceDerived ? numeric.amount! / numeric.quantity! : numeric.unitPrice;
    if (price !== null && (!Number.isFinite(price) || price > 1e15 || price <= 0)) {
      invalid = true;
      issue(r, 'Расчётная цена выходит за допустимый диапазон.');
    }
    const data: Omit<Purchase, 'id'> = {
      number: number ?? '',
      title: title ?? '',
      product: text('product'),
      code: text('code'),
      characteristics: text('characteristics'),
      comparisonGroup: text('comparisonGroup'),
      date: date === 'invalid' ? null : date,
      region: text('region'),
      quantity: numeric.quantity,
      unit: text('unit'),
      unitPrice: price,
      amount: numeric.amount,
      currency: text('currency'),
      vat: text('vat'),
      priceKind: text('priceKind'),
      status: text('status'),
      priceDerived,
      source: { file, sheet: sheet.name, row: r },
    };
    if (invalid) {
      report.skippedRows++;
      continue;
    }
    const id = purchaseId(data);
    if (seen.has(id)) {
      report.duplicates++;
      continue;
    }
    seen.add(id);
    records.push({ id, ...data });
  }
  report.validRows = records.length;
  return { report, records };
}
