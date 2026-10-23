import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  RecommendationRequest,
  RecommendationResponse,
  VectorSpaceResponse,
} from '@bnect/shared';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { embeddingProvider } from '../src/embedding.js';
import { demoSuppliers } from '../src/data/index.js';
import { supplierText, tenderText } from '../src/text.js';
import { TenderRepository } from '../src/repository.js';
import { RecommendationService } from '../src/service.js';
import ExcelJS from 'exceljs';
import { CSV_HEADERS } from '../src/data/csv.js';

// Deliberately uses the real ONNX model and PostgreSQL. No random/stub search vectors.
describe('real E5 + pgvector vertical slice', () => {
  let app: FastifyInstance;
  const profile = demoSuppliers.find((supplier) => supplier.id === 'demo-software')!;
  const request: RecommendationRequest = {
    profile,
    filters: { regionMode: 'all', selectedRegionIds: [] },
  };
  const post = async (url: string, body = request) => {
    const response = await app.inject({ method: 'POST', url, payload: body });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<RecommendationResponse>();
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  }, 30_000);
  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  test('Excel preview does not write, import indexes records and tender PCA highlights its own top five', async () => {
    const number = 'TEST-XLSX-RUNTIME';
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Тендеры');
    sheet.addRow([...CSV_HEADERS]);
    sheet.addRow([
      number,
      'Поставка серверов для информационной системы',
      'Астана',
      new Date('2026-10-01T00:00:00Z'),
      'Информационные технологии',
      'Серверное оборудование',
      'Тендер',
      'Товары',
    ]);
    const payload = {
      fileName: 'test.xlsx',
      dataBase64: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
      dryRun: true,
    };
    try {
      const preview = await app.inject({ method: 'POST', url: '/api/imports/excel', payload });
      expect(preview.statusCode, preview.body).toBe(200);
      expect(preview.json().changes.inserted).toBe(1);
      expect(
        (await pool.query('SELECT id FROM tenders WHERE external_number=$1', [number])).rowCount,
      ).toBe(0);
      const imported = await app.inject({
        method: 'POST',
        url: '/api/imports/excel',
        payload: { ...payload, dryRun: false },
      });
      expect(imported.statusCode, imported.body).toBe(200);
      expect(imported.json().indexError).toBeUndefined();
      const inserted = await pool.query(
        'SELECT id,embedding FROM tenders WHERE external_number=$1',
        [number],
      );
      expect(inserted.rows[0].embedding).not.toBeNull();
      const id = inserted.rows[0].id;
      const projection = await app.inject({
        method: 'GET',
        url: '/api/vector-space?tenderId=' + id,
      });
      expect(projection.statusCode, projection.body).toBe(200);
      const data = projection.json<VectorSpaceResponse>();
      expect(data.query.source).toBe('tender');
      expect(data.recommendations.query.tenderId).toBe(id);
      expect(data.points.filter((point) => point.recommended)).toHaveLength(5);
      expect(data.recommendations.results.every((item) => item.tender.id !== id)).toBe(true);
      const repeated = await app.inject({ method: 'POST', url: '/api/imports/excel', payload });
      expect(repeated.json().changes.inserted).toBe(0);
    } finally {
      await pool.query('DELETE FROM tenders WHERE external_number=$1', [number]);
    }
  }, 120_000);

  test('pgvector top-5 equals independently computed full-dimensional cosine ranking', async () => {
    const vector = await embeddingProvider.embedQuery(supplierText(profile));
    expect(vector).toHaveLength(384);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 5);
    const { rows } = await pool.query(
      'SELECT id, embedding::text AS vector FROM tenders ORDER BY id',
    );
    expect(rows.length).toBeGreaterThanOrEqual(80);
    const expected = rows
      .map((row) => {
        const document = JSON.parse(row.vector) as number[];
        const score =
          document.reduce((sum, value, i) => sum + value * vector[i]!, 0) /
          (Math.hypot(...document) * Math.hypot(...vector));
        return { id: row.id, score };
      })
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 5);
    const result = await post('/api/recommendations');
    expect(result.results.map((item) => item.tender.id)).toEqual(expected.map((item) => item.id));
    result.results.forEach((item, i) => expect(item.similarity).toBeCloseTo(expected[i]!.score, 5));
    expect(result.query.source).toBe('profile');
    expect(result.candidateCount).toBe(rows.length);
    expect(result.results[0]!.tender.industryGroup).toBe('Информационные технологии');
  }, 120_000);

  test('SQL filters apply before top-5 and a shortage never expands geography or industry', async () => {
    const result = await post('/api/recommendations', {
      profile,
      filters: {
        regionMode: 'selected',
        selectedRegionIds: ['almaty'],
        applySupplierIndustryGroups: true,
        applySupplierProcurementTypes: true,
      },
    });
    const count = await pool.query(
      "SELECT count(*)::int AS total FROM tenders WHERE region_id='almaty' AND industry_group=ANY($1) AND procurement_type=ANY($2)",
      [profile.industryGroups, profile.procurementTypes],
    );
    expect(result.candidateCount).toBe(count.rows[0].total);
    expect(result.results).toHaveLength(Math.min(5, count.rows[0].total));
    expect(result.results.length).toBeLessThan(5);
    result.results.forEach(({ tender }) => {
      expect(tender.regionId).toBe('almaty');
      expect(profile.industryGroups).toContain(tender.industryGroup);
      expect(profile.procurementTypes).toContain(tender.procurementType);
    });
    const empty = await post('/api/recommendations', {
      profile,
      filters: {
        regionMode: 'all',
        selectedRegionIds: [],
        industryGroups: ['Несуществующая демонстрационная отрасль'],
      },
    });
    expect(empty.candidateCount).toBe(0);
    expect(empty.results).toEqual([]);
  }, 60_000);

  test('similar tenders use the selected tender query text, exclude self and retain active geography', async () => {
    const first = (await post('/api/recommendations')).results[0]!.tender;
    const result = await post(`/api/tenders/${first.id}/similar`, {
      profile,
      filters: { regionMode: 'selected', selectedRegionIds: ['astana'] },
    });
    expect(result.query.source).toBe('tender');
    expect(result.query.text).toBe(tenderText(first));
    expect(
      result.results.every(
        (item) => item.tender.id !== first.id && item.tender.regionId === 'astana',
      ),
    ).toBe(true);
  }, 60_000);

  test('PCA coordinates remain fixed for another profile; query is projected separately', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/vector-space', payload: request });
    expect(a.statusCode, a.body).toBe(200);
    const first = a.json<VectorSpaceResponse>();
    const b = await app.inject({
      method: 'POST',
      url: '/api/vector-space',
      payload: {
        ...request,
        profile: demoSuppliers.find((supplier) => supplier.id === 'demo-medical')!,
      },
    });
    expect(b.statusCode, b.body).toBe(200);
    const second = b.json<VectorSpaceResponse>();
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.points.map(({ tender, x, y }) => [tender.id, x, y])).toEqual(
      second.points.map(({ tender, x, y }) => [tender.id, x, y]),
    );
    expect(first.query).not.toEqual(second.query);
    expect(
      first.explainedVariance.every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
    ).toBe(true);
    expect(first.explainedVariance[0] + first.explainedVariance[1]).toBeLessThanOrEqual(1.000001);
  }, 60_000);

  test('a second index pass does no inference and preserves embedding timestamps', async () => {
    const before = await pool.query(
      'SELECT id, embedded_at::text AS embedded_at FROM tenders ORDER BY id',
    );
    const repository = new TenderRepository();
    const result = await repository.index(
      {
        embedQuery: async () => {
          throw new Error('Unexpected query inference');
        },
        embedDocuments: async () => {
          throw new Error('Unchanged documents must reuse persisted embeddings');
        },
      },
      false,
      () => {},
    );
    expect(result.indexed).toBe(0);
    expect(result.unchanged).toBe(before.rowCount);
    const after = await pool.query(
      'SELECT id, embedded_at::text AS embedded_at FROM tenders ORDER BY id',
    );
    expect(after.rows).toEqual(before.rows);
  });

  test('empty constrained regions fail validation and literal wildcard search is not expanded', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/recommendations',
      payload: { ...request, filters: { regionMode: 'selected', selectedRegionIds: [] } },
    });
    expect(response.statusCode).toBe(400);
    const search = await app.inject({ method: 'GET', url: '/api/tenders?q=%25' });
    expect(search.statusCode, search.body).toBe(200);
    expect(search.json().total).toBe(0);
  });

  test('simple GET similar needs only a selected tender and no supplier profile', async () => {
    const selected = (await post('/api/recommendations')).results[0]!.tender;
    const response = await app.inject({
      method: 'GET',
      url: `/api/tenders/${selected.id}/similar`,
    });
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<RecommendationResponse>();
    expect(result.query.source).toBe('tender');
    expect(result.query.text).toBe(tenderText(selected));
    expect(result.results).toHaveLength(5);
    expect(result.results.every(({ tender }) => tender.id !== selected.id)).toBe(true);
    expect(result.filters.regionMode).toBe('all');
    expect(result.candidateCount).toBe(result.totalCount - 1);
  }, 60_000);

  test('a concurrent import cannot change the corpus halfway through a recommendation', async () => {
    const original = await post('/api/recommendations');
    const winner = original.results[0]!.tender;
    const { rows } = await pool.query('SELECT embedding::text AS vector FROM tenders WHERE id=$1', [
      winner.id,
    ]);
    const service = new RecommendationService(new TenderRepository(), {
      embedQuery: async (text) => {
        // This commit occurs AFTER readiness was checked and BEFORE the search.
        await pool.query('UPDATE tenders SET embedding=NULL WHERE id=$1', [winner.id]);
        return embeddingProvider.embedQuery(text);
      },
      embedDocuments: (texts) => embeddingProvider.embedDocuments(texts),
    });
    try {
      const duringImport = await service.recommend(request);
      expect(duringImport.results.map((item) => item.tender.id)).toEqual(
        original.results.map((item) => item.tender.id),
      );
      expect(duringImport.candidateCount).toBe(original.candidateCount);
      await expect(new TenderRepository().assertIndexReady()).rejects.toMatchObject({
        code: 'EMBEDDINGS_MISSING',
      });
    } finally {
      await pool.query('UPDATE tenders SET embedding=$2::vector WHERE id=$1', [
        winner.id,
        rows[0].vector,
      ]);
    }
  }, 60_000);

  test('upsert preserves vectors for metadata changes and invalidates changed semantic content', async () => {
    const original = (await post('/api/recommendations')).results[0]!.tender;
    const { rows } = await pool.query(
      'SELECT embedding::text AS vector,model_id,embedding_version,content_hash,embedded_at::text AS embedded_at FROM tenders WHERE id=$1',
      [original.id],
    );
    const saved = rows[0];
    const repository = new TenderRepository();
    try {
      const metadata = await repository.upsertTenders([
        { ...original, regionId: original.regionId === 'almaty' ? 'astana' : 'almaty' },
      ]);
      expect(metadata.updated).toBe(1);
      const same = await pool.query(
        'SELECT id,embedding::text AS vector,embedded_at::text AS embedded_at FROM tenders WHERE external_number=$1',
        [original.externalNumber],
      );
      expect(same.rows).toEqual([
        { id: original.id, vector: saved.vector, embedded_at: saved.embedded_at },
      ]);
      await repository.upsertTenders([
        { ...original, title: `${original.title} (изменение предмета)` },
      ]);
      const changed = await pool.query('SELECT embedding,content_hash FROM tenders WHERE id=$1', [
        original.id,
      ]);
      expect(changed.rows[0]).toEqual({ embedding: null, content_hash: null });
      await expect(repository.assertIndexReady()).rejects.toMatchObject({
        code: 'EMBEDDINGS_MISSING',
      });
      await pool.query('UPDATE tenders SET model_id=$2 WHERE id=$1', [
        original.id,
        'incompatible-model',
      ]);
      await pool.query('UPDATE tenders SET embedding=$2::vector WHERE id=$1', [
        original.id,
        saved.vector,
      ]);
      await expect(repository.assertIndexReady()).rejects.toMatchObject({
        code: 'REINDEX_REQUIRED',
      });
    } finally {
      await repository.upsertTenders([original]);
      await pool.query(
        'UPDATE tenders SET embedding=$2::vector,model_id=$3,embedding_version=$4,content_hash=$5,embedded_at=$6::timestamptz WHERE id=$1',
        [
          original.id,
          saved.vector,
          saved.model_id,
          saved.embedding_version,
          saved.content_hash,
          saved.embedded_at,
        ],
      );
    }
  }, 60_000);
});
