import { regions } from '../data/regions.js';
import { normalize } from './domain.js';

const regionNames = new Map<string, string>();
for (const region of regions) {
  for (const alias of [region.name, ...region.aliases]) {
    const key = normalize(alias);
    if (!regionNames.has(key)) regionNames.set(key, region.name);
  }
}

export function canonicalRegion(value: string | null): string | null {
  return value ? (regionNames.get(normalize(value)) ?? value) : null;
}

export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number')
    return Number.isFinite(value) && Math.abs(value) <= 1e15 ? value : NaN;
  const text = String(value)
    .trim()
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(',', '.');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return NaN;
  const result = Number(text);
  return Number.isFinite(result) && Math.abs(result) <= 1e15 ? result : NaN;
}

export function parseDate(value: unknown, date1904 = false): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : 'invalid';
  if (typeof value === 'number') {
    // Serial 60 is the nonexistent 1900-02-29; reject instead of shifting dates.
    if ((!date1904 && value < 61) || value < 0 || value > 2958465) return 'invalid';
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    return new Date(epoch + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const russian = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  const iso = russian ? `${russian[3]}-${russian[2]}-${russian[1]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(iso)) return 'invalid';
  const day = iso.slice(0, 10);
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day
    ? day
    : 'invalid';
}
