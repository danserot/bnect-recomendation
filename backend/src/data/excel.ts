import ExcelJS from 'exceljs';
import { parseTenderCsv } from './csv.js';
import { AppError } from '../errors.js';

/** Read only the first sheet; use the same validation and duplicate policy as CSV. */
export async function parseTenderExcel(buffer: Buffer) {
  if (!buffer.length || buffer.length > 5 * 1024 * 1024)
    throw new AppError(400, 'FILE_SIZE', 'Выберите непустой .xlsx файл размером до 5 МБ.');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch {
    throw new AppError(
      400,
      'INVALID_EXCEL',
      'Не удалось прочитать Excel. Нужен файл .xlsx без пароля.',
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2)
    throw new AppError(
      400,
      'EMPTY_EXCEL',
      'Первый лист должен содержать заголовки и строки тендеров.',
    );
  if (sheet.rowCount > 50001 || sheet.columnCount > 32)
    throw new AppError(400, 'EXCEL_LIMIT', 'Допускается до 50000 строк тендеров и 32 столбцов.');
  const csv: string[] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const values: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
      const cell = sheet.getRow(r).getCell(c);
      if (cell.type === ExcelJS.ValueType.Formula)
        throw new AppError(
          400,
          'EXCEL_FORMULA',
          `Строка ${r}, столбец ${c}: замените формулу её значением.`,
        );
      const value = cell.value instanceof Date ? cell.value.toISOString() : cell.text;
      values.push(`"${value.replaceAll('"', '""')}"`);
    }
    csv.push(values.join(';'));
  }
  return { ...parseTenderCsv(csv.join('\n')), sheetName: sheet.name };
}
