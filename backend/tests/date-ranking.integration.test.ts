import { afterAll, expect, test } from 'vitest';
import { pool } from '../src/db.js';
import { TenderRepository } from '../src/repository.js';
import { vectorLiteral } from '../src/tenders/records.js';

afterAll(() => pool.end());

test('title similarity ranks eligible tenders within the same region', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Isolated fixtures shadow the real table on this connection only.
    await client.query(
      'CREATE TEMP TABLE tenders (LIKE public.tenders INCLUDING DEFAULTS) ON COMMIT DROP',
    );
    const vector = (cosine: number) => [cosine, Math.sqrt(1 - cosine ** 2), ...Array(382).fill(0)];
    const insert = async (
      id: string,
      date: string,
      cosine: number,
      hash = id,
      region = 'astana',
      activity = 'Electrical work',
      title = id,
    ) =>
      client.query(
        `INSERT INTO tenders (id,external_number,title,region_id,created_at,industry_group,activity,
       procurement_method,procurement_type,source,embedding,content_hash)
       VALUES ($1,$1,$7,$5,$2,'Construction',$6,'Tender','Works','demo',$3::vector,$4)`,
        [id, date, vectorLiteral(vector(cosine)), hash, region, activity, title],
      );
    const referenceDate = '2026-10-15T00:00:00Z';
    await insert('selected', referenceDate, 1);
    await insert('other-region', referenceDate, 1, undefined, 'almaty');
    await insert('other-activity', referenceDate, 1, undefined, undefined, 'Plumbing');
    await insert('same-date', referenceDate, 0.5);
    await insert('before', '2026-10-14T00:00:00Z', 0.8, 'duplicate-subject');
    await insert('duplicate', '2026-10-14T00:00:00Z', 0.7, 'duplicate-subject');
    await insert('after', '2026-10-16T00:00:00Z', 0.6);
    await insert('tie-a', '2026-10-17T00:00:00Z', 0.9);
    await insert('tie-b', '2026-10-13T00:00:00Z', 0.9);
    await insert('sixth', '2026-10-18T00:00:00Z', 1);
    await insert('farthest', '2025-01-01T00:00:00Z', 1);
    const repository = new TenderRepository((sql, values) => client.query(sql, values));
    const filters = {
      regionMode: 'selected' as const,
      selectedRegionIds: ['astana'],
      regionIds: ['astana'],
      regionNames: ['Астана'],
    };
    const result = await repository.search(vector(1), undefined, filters, 'selected');
    expect(result.rows.map(({ tender }) => tender.id)).toEqual([
      'farthest',
      'other-activity',
      'sixth',
      'tie-a',
      'tie-b',
    ]);
    expect(new Set(result.rows.map(({ tender }) => tender.id)).size).toBe(5);
    await client.query("DELETE FROM tenders WHERE id='duplicate'");
    const ties = await repository.search(vector(1), undefined, filters, 'selected');
    expect(ties.rows.map(({ tender }) => tender.id)).toEqual([
      'farthest',
      'other-activity',
      'sixth',
      'tie-a',
      'tie-b',
    ]);
    expect(result.rows[0]!.similarity).toBeCloseTo(1);
    const profileResult = await repository.search(vector(1), undefined, filters, 'selected');
    expect(profileResult.rows[0]!.similarity).toBeCloseTo(1);
    const empty = await repository.search(
      vector(1),
      undefined,
      { ...filters, regionIds: [] },
      'selected',
    );
    expect(empty.rows).toEqual([]);
    await client.query(
      "DELETE FROM tenders WHERE id NOT IN ('selected', 'before', 'other-region', 'other-activity')",
    );
    await insert('fallback-1', '2026-10-16T00:00:00Z', 0.8, undefined, undefined, 'Plumbing');
    await insert('fallback-2', '2026-10-17T00:00:00Z', 0.8, undefined, undefined, 'Plumbing');
    await insert('fallback-3', '2026-10-18T00:00:00Z', 0.8, undefined, undefined, 'Plumbing');
    const filled = await repository.search(vector(1), undefined, filters, 'selected');
    expect(filled.rows.map(({ tender }) => tender.id)).toEqual([
      'other-activity',
      'before',
      'fallback-1',
      'fallback-2',
      'fallback-3',
    ]);
    expect(filled.candidateCount).toBe(5);
    expect(filled.rows.every(({ tender }) => tender.regionId === 'astana')).toBe(true);
    await client.query("DELETE FROM tenders WHERE id NOT IN ('selected', 'before', 'after')");
    const shortage = await repository.search(vector(1), undefined, filters, 'selected');
    expect(shortage.rows.map(({ tender }) => tender.id)).toEqual(['before']);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
