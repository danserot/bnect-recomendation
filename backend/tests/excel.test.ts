import { describe, test, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseTenderExcel } from '../src/data/excel.js';
import { CSV_HEADERS } from '../src/data/csv.js';
async function file(row: unknown[]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Тендеры');
  sheet.addRow([...CSV_HEADERS]);
  sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}
const row = [
  'XLSX-1',
  'Поставка серверного оборудования',
  'Нур-Султан',
  new Date('2026-10-01T00:00:00Z'),
  'Информационные технологии',
  'Серверы',
  'Тендер',
  'Товары',
];
describe('Excel import adapter', () => {
  test('reads native Excel dates and canonical regions without inventing status', async () => {
    const result = await parseTenderExcel(await file(row));
    expect(result.errors).toEqual([]);
    expect(result.tenders[0]).toMatchObject({
      externalNumber: 'XLSX-1',
      regionId: 'astana',
      createdAt: '2026-10-01T00:00:00.000Z',
      source: 'import',
    });
    expect(result.tenders[0].status).toBeUndefined();
  });
  test('reports missing required fields', async () => {
    const result = await parseTenderExcel(await file([...row.slice(0, 1), '', ...row.slice(2)]));
    expect(result.errors[0]?.row).toBe(2);
    expect(result.tenders).toHaveLength(0);
  });
  test('rejects corrupt workbooks', async () => {
    await expect(parseTenderExcel(Buffer.from('bad excel'))).rejects.toMatchObject({
      code: 'INVALID_EXCEL',
    });
  });
  test('rejects formulas rather than relying on stale cached values', async () => {
    await expect(
      parseTenderExcel(await file([{ formula: '1+1', result: 2 }, ...row.slice(1)])),
    ).rejects.toMatchObject({ code: 'EXCEL_FORMULA' });
  });
});
