import { describe, expect, test } from 'vitest';
import { parseDate, parseNumber, parsePurchaseExcel } from '../src/analytics/import.js';
import { compatibilityKey, productKey, priceDifference } from '../src/analytics/domain.js';
import { changed, controlRow, purchaseWorkbook } from './purchase-fixture.js';

describe('purchase Excel validation and comparison rules', () => {
  test('handles locale numbers, real dates, serial dates, derived prices and missing prices', async () => {
    const file = await purchaseWorkbook(
      [
        changed('DECIMAL', {
          5: new Date('2026-10-01T00:00:00Z'),
          7: '1 000',
          9: '',
          10: '125 500,50',
        }),
        changed('SERIAL', { 5: 46310, 9: '1\u202f250,25' }),
        changed('NO-PRICE', { 7: '', 9: '', 10: 5000 }),
      ],
      true,
    );
    const { records, report } = await parsePurchaseExcel(file, 'control.xlsx');
    expect(report.sheets).toHaveLength(2);
    expect(report.sample).toHaveLength(3);
    expect(records[0]).toMatchObject({
      date: '2026-10-01',
      quantity: 1000,
      unitPrice: 125.5005,
      priceDerived: true,
    });
    expect(records[1].unitPrice).toBe(1250.25);
    expect(records[1].date).toBe(parseDate(46310));
    expect(records[2].unitPrice).toBeNull();
    expect(records[2].amount).toBe(5000);
    expect(parseNumber('abc')).toBeNaN();
    expect(parseDate('31.02.2026')).toBe('invalid');
    expect(parseDate(60)).toBe('invalid');
    expect(parseDate(0, true)).toBe('1904-01-01');
    expect(parseDate('01.10.2026')).toBe('2026-10-01');
  });
  test('invalid rows are reported individually, empty cells remain unknown and duplicates are visible', async () => {
    const { records, report } = await parsePurchaseExcel(
      await purchaseWorkbook([
        controlRow,
        controlRow,
        changed('ZERO', { 7: 0 }),
        changed('BAD-NUMBER', { 9: 'abc' }),
        changed('BAD-DATE', { 5: '31.02.2026' }),
        changed('FORMULA', { 9: { formula: '1+1', result: 2 } }),
        changed('UNKNOWN', { 4: '', 11: '', 12: '', 13: '' }),
      ]),
      'test.xlsx',
    );
    expect(report).toMatchObject({ totalRows: 7, validRows: 2, duplicates: 1, skippedRows: 4 });
    expect(report.issues.map((i) => i.row)).toEqual(expect.arrayContaining([4, 5, 6, 7]));
    expect(records[1]).toMatchObject({
      characteristics: null,
      currency: null,
      vat: null,
      priceKind: null,
    });
    expect(compatibilityKey(records[1])).toBeNull();
  });
  test('the same source rows in renamed workbooks reuse IDs, selected sheet is honored', async () => {
    const file = await purchaseWorkbook([controlRow], true);
    const a = await parsePurchaseExcel(file, 'one.xlsx');
    const b = await parsePurchaseExcel(file, 'two.xlsx', 'Другой лист');
    expect(a.records[0].id).toBe(b.records[0].id);
    expect(b.report.sheet).toBe('Другой лист');
  });
  test('similar names and category codes alone cannot authorize comparison', async () => {
    const {
      records: [p],
    } = await parsePurchaseExcel(await purchaseWorkbook([controlRow]), 'test.xlsx');
    expect(productKey({ ...p, characteristics: null })).toBeNull();
    expect(compatibilityKey({ ...p, vat: null })).toBeNull();
    expect(compatibilityKey({ ...p, unit: 'кг' })).not.toBe(compatibilityKey(p));
    expect(compatibilityKey({ ...p, priceKind: 'плановая' })).not.toBe(compatibilityKey(p));
    expect(
      productKey({ ...p, characteristics: null, comparisonGroup: 'Подтверждено 1' }),
    ).not.toBeNull();
    expect(priceDifference(120, 175)).toBeCloseTo(-31.428571);
    expect(priceDifference(120, 0)).toBeNull();
    expect(priceDifference(null, 100)).toBeNull();
  });
  test('rejects corrupt input', async () => {
    await expect(parsePurchaseExcel(Buffer.from('bad'), 'test.xlsx')).rejects.toMatchObject({
      code: 'INVALID_EXCEL',
    });
  });
});
