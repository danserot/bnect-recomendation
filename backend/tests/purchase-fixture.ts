import ExcelJS from 'exceljs';

export const purchaseHeaders = [
  'Номер закупки',
  'Наименование закупки',
  'Товар',
  'Код товара',
  'Характеристики',
  'Дата',
  'Регион',
  'Количество',
  'Единица измерения',
  'Цена за единицу',
  'Общая сумма',
  'Валюта',
  'НДС',
  'Вид цены',
  'Статус',
];
export const controlRow = [
  'CONTROL-SELECTED',
  'Бумага A4 80 г/м²',
  'Бумага',
  'P-A4',
  'A4; 80 г/м²; 500 листов',
  '2026-10-15',
  'Астана',
  10,
  'шт',
  120,
  1200,
  'KZT',
  'без НДС',
  'фактическая',
  'Завершена',
];

export async function purchaseWorkbook(rows: unknown[][], secondSheet = false) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Контрольные закупки');
  sheet.addRow(purchaseHeaders);
  rows.forEach((row) => sheet.addRow(row));
  if (secondSheet) {
    const other = book.addWorksheet('Другой лист');
    other.addRow(purchaseHeaders);
    other.addRow(controlRow);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export function changed(number: string, changes: Record<number, unknown> = {}) {
  const row: unknown[] = [...controlRow];
  row[0] = number;
  Object.entries(changes).forEach(([i, value]) => {
    row[Number(i)] = value;
  });
  return row;
}

/** Synthetic verification input only. Never seeded into the user's analytics catalog. */
export const controlRows = [
  controlRow,
  changed('CONTROL-A', { 5: '2026-09-15', 7: 10, 9: 100, 10: 1000 }),
  changed('CONTROL-B', { 5: '2026-09-20', 7: 30, 9: 200, 10: 6000 }),
  changed('CONTROL-OTHER-REGION', { 6: 'Атырау', 7: 20, 9: 300, 10: 6000 }),
  changed('CONTROL-CURRENCY', { 11: 'USD', 9: 99999 }),
  changed('CONTROL-UNIT', { 8: 'кг', 9: 99999 }),
  changed('CONTROL-VAT', { 12: 'с НДС', 9: 99999 }),
  changed('CONTROL-PLAN', { 13: 'плановая', 9: 99999 }),
  changed('CONTROL-SPEC', { 4: 'A3; 80 г/м²; 500 листов', 9: 99999 }),
  changed('CONTROL-OLD', { 5: '2025-01-15', 9: 99999 }),
];
