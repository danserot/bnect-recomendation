import { describe, expect, it } from 'vitest';
import {
  CSV_HEADERS,
  DEMO_NOW,
  demoSuppliers,
  generateDemoTenders,
  normalizeRegion,
  parseSourceDate,
  parseTenderCsv,
  regions,
} from '../src/data/index.js';

const csv = (...rows: string[][]): string =>
  [CSV_HEADERS.join(';'), ...rows.map((row) => row.join(';'))].join('\n');
const row = (
  number: string,
  region = 'г. Астана',
  date = '2026-10-01',
  title = 'Разработка портала',
): string[] => [
  number,
  title,
  region,
  date,
  'Информационные технологии',
  'Разработка и сопровождение ПО',
  'Открытый конкурс',
  'Услуги',
];

describe('canonical regions', () => {
  it('resolves aliases as complete names and keeps city and oblast separate', () => {
    expect(normalizeRegion(' АСТАНА ')?.id).toBe('astana');
    expect(normalizeRegion('Нур-Султан')?.id).toBe('astana');
    expect(normalizeRegion('г. Астана')?.id).toBe('astana');
    expect(normalizeRegion('Алматы')?.id).toBe('almaty');
    expect(normalizeRegion('Алматинская область')?.id).toBe('almaty-region');
    expect(normalizeRegion('доставка из Алматы')).toBeUndefined();
    expect(normalizeRegion('')).toBeUndefined();
  });

  it('contains no conflicting normalized aliases', () => {
    const seen = new Map<string, string>();
    for (const region of regions)
      for (const alias of [region.id, region.name, ...region.aliases]) {
        const key = alias.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
        expect(seen.get(key) ?? region.id).toBe(region.id);
        seen.set(key, region.id);
      }
  });
});

describe('reproducible synthetic data', () => {
  it('generates at least 80 records with varied subjects, regions and stable seed', () => {
    const tenders = generateDemoTenders();
    expect(tenders).toHaveLength(96);
    expect(tenders).toEqual(generateDemoTenders());
    expect(tenders).not.toEqual(generateDemoTenders(42));
    expect(new Set(tenders.map((tender) => tender.externalNumber)).size).toBe(96);
    expect(new Set(tenders.map((tender) => tender.id)).size).toBe(96);
    expect(new Set(tenders.map((tender) => tender.industryGroup)).size).toBe(12);
    expect(new Set(tenders.map((tender) => tender.regionId)).size).toBeGreaterThan(8);
    expect(tenders.every((tender) => tender.source === 'demo')).toBe(true);
    expect(tenders.some((tender) => tender.regionId === null)).toBe(true);
  });

  it('uses explicit demo time and leaves some availability unknown', () => {
    const tenders = generateDemoTenders();
    expect(tenders.every((tender) => Date.parse(tender.createdAt) < Date.parse(DEMO_NOW))).toBe(
      true,
    );
    expect(
      tenders
        .filter((tender) => tender.status === 'open')
        .every((tender) => Date.parse(tender.applicationDeadline!) > Date.parse(DEMO_NOW)),
    ).toBe(true);
    expect(
      tenders
        .filter((tender) => tender.status === 'closed')
        .every((tender) => Date.parse(tender.applicationDeadline!) < Date.parse(DEMO_NOW)),
    ).toBe(true);
    expect(tenders.some((tender) => !tender.status && !tender.applicationDeadline)).toBe(true);
    expect(demoSuppliers.every((profile) => profile.specializationDescription.length > 80)).toBe(
      true,
    );
  });
});

describe('CSV import adapter', () => {
  it('maps Russian headers, handles BOM and preserves absent availability', () => {
    const parsed = parseTenderCsv(
      `\uFEFF${csv(row('001'), row('002', 'Нур-Султан'), row('003', 'Алматинская область'), row('004', 'Регион неизвестен'))}`,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.totalRows).toBe(4);
    expect(parsed.tenders.map((tender) => tender.regionId)).toEqual([
      'astana',
      'astana',
      'almaty-region',
      null,
    ]);
    expect(parsed.tenders[0]!.externalNumber).toBe('001');
    expect(
      parsed.tenders.every(
        (tender) =>
          tender.source === 'import' &&
          tender.status === undefined &&
          tender.applicationDeadline === undefined,
      ),
    ).toBe(true);
  });

  it('keeps the last valid duplicate and reports its rows', () => {
    const parsed = parseTenderCsv(
      csv(
        row('001'),
        row('001', 'Алматы', '2026-10-02', 'Новая редакция'),
        row('001', 'Астана', '31.02.2026'),
      ),
    );
    expect(parsed.tenders).toHaveLength(1);
    expect(parsed.tenders[0]!.title).toBe('Новая редакция');
    expect(parsed.duplicates).toEqual([
      { externalNumber: '001', previousRow: 2, row: 3, policy: 'last-valid-row-wins' },
    ]);
    expect(parsed.errors).toEqual([expect.objectContaining({ row: 4, field: 'Дата создания' })]);
    expect(parsed.tenders[0]!.id).toBe(parseTenderCsv(csv(row('001'))).tenders[0]!.id);
  });

  it('reports required headers and field errors without inventing values', () => {
    expect(
      parseTenderCsv('№ тендера;Регион\n001;Астана').errors.some(
        (error) => error.field === 'Дата создания',
      ),
    ).toBe(true);
    const parsed = parseTenderCsv(csv(row(''), row('002', 'Астана', '2026-10-01', '')));
    expect(parsed.tenders).toEqual([]);
    expect(parsed.errors.map((error) => error.field)).toEqual([
      '№ тендера',
      'Наименование тендера',
    ]);
  });

  it('reads commas and quoted delimiters and reports malformed records', () => {
    const input = `${CSV_HEADERS.join(',')}\n001,"Портал, каталог",Алматы,2026-10-01,ИТ,Разработка,Конкурс,Услуги`;
    expect(parseTenderCsv(input).tenders[0]!.title).toBe('Портал, каталог');
    expect(parseTenderCsv(`${csv(row('001'))}\n002;неполная строка`).errors[0]?.field).toBe('CSV');
    expect(
      parseTenderCsv(`${CSV_HEADERS.join(';')}\n001;"незакрытая кавычка`).errors[0]?.field,
    ).toBe('CSV');
  });

  it('accepts only valid unambiguous calendar dates', () => {
    expect(parseSourceDate('31.02.2026')).toBeUndefined();
    expect(parseSourceDate('2026-13-01')).toBeUndefined();
    expect(parseSourceDate('01/02/2026')).toBeUndefined();
    expect(parseSourceDate('29.02.2024')).toBe('2024-02-29T00:00:00.000Z');
    expect(parseSourceDate('2026-10-01T10:00:00+05:00')).toBe('2026-10-01T05:00:00.000Z');
  });
});
