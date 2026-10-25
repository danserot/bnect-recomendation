import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import pg from 'pg';
import Fastify from 'fastify';
import { config } from '../src/config.js';
import { PurchaseRepository, type AnalyticsQuery } from '../src/analytics/repository.js';
import { purchaseMigration } from '../src/analytics/schema.js';
import { registerPurchaseRoutes } from '../src/analytics/routes.js';
import { parsePurchaseExcel } from '../src/analytics/import.js';
import { changed, controlRow, controlRows, purchaseWorkbook } from './purchase-fixture.js';
import { ZodError } from 'zod';

describe('purchase analytics with real PostgreSQL, isolated schema', () => {
  const schema = `analytics_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Pool({ connectionString: config.databaseUrl });
  const connection = new pg.Pool({
    connectionString: config.databaseUrl,
    options: `-c search_path=${schema}`,
  });
  const repository = new PurchaseRepository(connection);
  const app = Fastify();
  registerPurchaseRoutes(app, repository);
  app.setErrorHandler((error, _request, reply) =>
    reply.code(error instanceof ZodError ? 400 : 500).send({ error: error.name }),
  );
  const now = new Date('2026-10-25T12:00:00Z');
  const base: AnalyticsQuery = { q: '', period: '6', page: 1, pageSize: 2, region: 'Астана' };
  let selectedId: string;
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await connection.query(purchaseMigration);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await connection.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });
  test('empty catalog and dry-run never write data', async () => {
    expect(await repository.readiness(now)).toMatchObject({
      totalRows: 0,
      rowsWithAnalogs: 0,
      completeChartRows: 0,
      expectedIntervals: 7,
    });
    expect((await repository.options()).total).toBe(0);
    expect((await repository.analytics(base, now)).items).toEqual([]);
    const file = await purchaseWorkbook(controlRows, true);
    const report = await app.inject({
      method: 'POST',
      url: '/api/analytics/import',
      payload: { fileName: 'control.xlsx', dataBase64: file.toString('base64'), dryRun: true },
    });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().validRows).toBe(10);
    expect((await repository.options()).total).toBe(0);
  });
  test('imports idempotently, paginates and aggregates all comparable rows before pagination', async () => {
    const { records } = await parsePurchaseExcel(
      await purchaseWorkbook(controlRows),
      'control.xlsx',
    );
    selectedId = records[0].id;
    expect(await repository.import(records)).toBe(10);
    expect(await repository.import(records)).toBe(0);
    const result = await repository.analytics(
      { ...base, selectedId, comparisonRegion: 'Атырауская область' },
      now,
    );
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(8);
    expect(result.main).toEqual({ price: 175, count: 2, volume: 40, method: 'weighted' });
    expect(result.comparison).toEqual({ price: 300, count: 1, volume: 20, method: 'weighted' });
    expect(result.difference).toBeCloseTo(-31.428571);
    expect(result.selected?.number).toBe('CONTROL-SELECTED');
    const september = result.buckets.find((b) => b.from === '2026-09-01');
    expect(result.buckets[0].from).toBe('2026-04-25');
    expect(result.buckets.at(-1)?.to).toBe('2026-10-25');
    expect(september?.main.price).toBe(175);
    expect(result.buckets.some((b) => b.main.price === null && b.main.count === 0)).toBe(true);
    expect(result.buckets.find((b) => b.from === '2026-10-01')?.main.price).toBeNull();
    expect((await repository.analytics({ ...base, selectedId, page: 2 }, now)).main).toEqual(
      result.main,
    );
  });
  test('incomplete quantities use arithmetic mean, undated rows are explicit and filters remain strict', async () => {
    const { records } = await parsePurchaseExcel(
      await purchaseWorkbook([
        changed('CONTROL-UNKNOWN-QTY', { 7: '', 9: 300, 10: '' }),
        changed('CONTROL-UNDATED', { 5: '', 7: 10, 9: 400, 10: 4000 }),
      ]),
      'control.xlsx',
    );
    await repository.import(records);
    const partial = await repository.analytics({ ...base, selectedId }, now);
    expect(partial.main).toEqual({ price: 200, count: 3, volume: null, method: 'arithmetic' });
    const all = await repository.analytics({ ...base, period: 'all', selectedId }, now);
    expect(all.undated).toBe(1);
    expect(all.main.count).toBe(5);
    const none = await repository.analytics(
      { ...base, region: 'Нет такого региона', selectedId },
      now,
    );
    expect(none.total).toBe(0);
    expect(none.selected).toBeNull();
    expect(none.main.price).toBeNull();
    const search = await repository.analytics({ ...base, q: 'CONTROL-SELECTED', selectedId }, now);
    expect(search.main.price).toBeNull();
    expect(search.main.count).toBe(0);
    expect((await repository.analytics({ ...base, q: '%' }, now)).total).toBe(0);
  });
  test('API validates parameters and exposes only observed columns', async () => {
    const invalid = await app.inject('/api/analytics/purchases?pageSize=999999');
    expect(invalid.statusCode).toBe(400);
    const options = await app.inject('/api/analytics/options');
    expect(options.json().total).toBe(12);
    expect(options.json().fields).toContain('unitPrice');
    expect(options.json().fields).not.toContain('comparisonGroup');
    const missing = await app.inject('/api/analytics/purchases?period=all');
    expect(missing.statusCode, missing.body).toBe(200);
  });
  test('excludes all lines of the selected procurement number', async () => {
    const { records } = await parsePurchaseExcel(
      await purchaseWorkbook([changed('CONTROL-SELECTED', { 9: 9999, 10: 99990 })]),
      'control.xlsx',
    );
    await repository.import(records);
    const result = await repository.analytics({ ...base, selectedId }, now);
    expect(result.main).toEqual({ price: 200, count: 3, volume: null, method: 'arithmetic' });
  });
  test('readiness counts chart availability after exclusion of every line of the selected document', async () => {
    const months = [
      '2026-04-28',
      '2026-05-15',
      '2026-06-15',
      '2026-07-15',
      '2026-08-15',
      '2026-09-15',
    ];
    const rows = [
      changed('FULL-ANCHOR', { 3: 'FULL-SKU', 5: '2026-10-15' }),
      ...months.map((date) => changed('FULL-EXCLUSIVE', { 3: 'FULL-SKU', 5: date })),
      changed('FULL-SECOND', { 3: 'FULL-SKU', 5: '2026-10-20' }),
    ];
    const { records } = await parsePurchaseExcel(await purchaseWorkbook(rows), 'synthetic.xlsx');
    await repository.import(records);
    const readiness = await repository.readiness(now);
    expect(readiness).toMatchObject({
      totalRows: 21,
      eligibleRows: 21,
      rowsWithAnalogs: 15,
      periodRows: 19,
      completeChartRows: 2,
      completeChartGroups: 1,
      expectedIntervals: 7,
      missingDateRows: 1,
      missingPriceRows: 0,
    });
    const response = await app.inject('/api/analytics/readiness');
    expect(response.statusCode, response.body).toBe(200);
    const { generatedAt, period, ...counts } = response.json();
    expect(
      Object.values(counts).every(
        (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0,
      ),
    ).toBe(true);
    expect(generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(period).sort()).toEqual(['from', 'grouping', 'to']);
    expect(response.body).not.toContain('FULL-ANCHOR');
    expect(response.body).not.toContain('unitPrice');
  });
});
