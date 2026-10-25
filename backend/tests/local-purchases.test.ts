import { expect, test } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLocalPurchases, newLocalReport } from '../src/analytics/local-file.js';
import { compatibilityKey } from '../src/analytics/domain.js';

test('large-file adapter separates source prices, preserves VAT basis and omits parties', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bnect-purchase-test-'));
  const file = join(directory, 'synthetic.xlsx');
  try {
    const book = new ExcelJS.Workbook();
    const summary = book.addWorksheet('Сводка');
    summary.addRow(['Средняя цена']);
    summary.addRow([99999]);
    const orders = book.addWorksheet('Заказы');
    orders.addRow([
      '№ заказа',
      'Дата заказа',
      'Статус заказа',
      'Код номенклатуры',
      'Наименование номенклатуры',
      'Регион',
      'Ед. изм.',
      'Количество',
      'Цена без НДС',
      'Сумма с НДС',
      'GUID поставщика',
      'Проект',
    ]);
    orders.addRow([
      'ORDER-1',
      new Date('2026-10-01T00:00:00Z'),
      'Завершён',
      'SKU-1',
      'Бумага A4',
      'Астана',
      'шт',
      10,
      100,
      1120,
      'SYNTHETIC-PARTY',
      'SYNTHETIC-PROJECT',
    ]);
    orders.addRow([
      'BAD',
      46310,
      'Завершён',
      'SKU-1',
      'Бумага A4',
      'Астана',
      'шт',
      0,
      100,
      0,
      'SECRET',
      'SECRET',
    ]);
    const offers = book.addWorksheet('Запросы');
    offers.addRow([
      '№ запроса',
      'Дата запроса',
      'Статус запроса',
      'Код номенклатуры',
      'Наименование номенклатуры',
      'Регион',
      'Ед. изм.',
      'Кол-во запрошено',
      'Кол-во предложено',
      'Цена без НДС',
      'Сумма с НДС',
      'GUID поставщика',
    ]);
    offers.addRow([
      'REQUEST-1',
      46310,
      'Закрыт',
      'SKU-1',
      'Бумага A4',
      'Астана',
      'шт',
      100,
      '',
      150,
      1680,
      'SYNTHETIC-PARTY',
    ]);
    await book.xlsx.writeFile(file);
    const report = newLocalReport('KZT');
    const records = [];
    for await (const p of readLocalPurchases(file, 'KZT', report)) records.push(p);
    expect(report).toMatchObject({
      read: 3,
      valid: 2,
      skipped: 1,
      currencyBasis: 'user-confirmed',
    });
    expect(records[0]).toMatchObject({
      unitPrice: 100,
      amount: 1120,
      vat: 'без НДС',
      amountVat: 'с НДС',
      currency: 'KZT',
      date: '2026-10-01',
    });
    expect(records[1].quantity).toBeNull(); // Requested volume is not offered volume.
    expect(compatibilityKey(records[0])).not.toBe(compatibilityKey(records[1]));
    expect(compatibilityKey(records[0])).not.toBeNull();
    expect(JSON.stringify(records)).not.toContain('SYNTHETIC-PARTY');
    expect(JSON.stringify(records)).not.toContain('SYNTHETIC-PROJECT');
  } finally {
    await rm(file, { force: true });
    await rmdir(directory);
  }
});
