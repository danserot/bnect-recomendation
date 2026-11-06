import { describe, expect, it } from 'vitest';
import type { Tender } from '@bnect/shared';
import {
  activityPriority,
  dateGap,
  fieldsMatch,
  sharedTerms,
} from '../../frontend/src/comparison/model';

const tender: Tender = {
  id: 'source',
  externalNumber: 'SYNTHETIC-1',
  title: 'Открытый тендер на стеклянные ограждения',
  activity: 'Монтаж ограждений',
  industryGroup: 'Строительство',
  regionId: 'astana',
  procurementMethod: 'Тендер',
  procurementType: 'СМР',
  createdAt: '2026-10-15T00:00:00Z',
  source: 'demo',
};

describe('evidence shown in tender comparisons', () => {
  it('does not claim matches for two missing or placeholder fields', () => {
    for (const value of [undefined, null, '', '—', ' - '])
      expect(fieldsMatch(value, value)).toBe(false);
    expect(fieldsMatch(' Монтаж\u00a0ограждений ', 'МОНТАЖ ОГРАЖДЕНИЙ')).toBe(true);
  });
  it('distinguishes matching activity, regional completion and missing source activity', () => {
    expect(activityPriority(tender, { ...tender, activity: ' монтаж   ограждений ' })).toBe('same');
    expect(activityPriority(tender, { ...tender, activity: 'Уборка' })).toBe('fallback');
    expect(activityPriority({ ...tender, activity: '—' }, tender)).toBe('unspecified');
  });
  it('explains dates in either direction relative to the source rather than the current time', () => {
    expect(dateGap(tender.createdAt, '2026-10-13T00:00:00Z')).toEqual({
      label: '2 дн.',
      direction: 'раньше исходного',
    });
    expect(dateGap(tender.createdAt, '2026-10-17T00:00:00Z')).toEqual({
      label: '2 дн.',
      direction: 'позже исходного',
    });
    expect(dateGap(tender.createdAt, '2026-10-15T05:00:00+05:00').label).toBe('Та же дата и время');
    expect(dateGap(tender.createdAt, '2026-10-15T00:30:00Z').label).toBe('30 мин');
    expect(dateGap(tender.createdAt, 'unknown').label).toBe('Дата не указана');
  });
  it('highlights only actual shared words and excludes procurement boilerplate', () => {
    const terms = sharedTerms(tender, {
      ...tender,
      title: 'Закрытый тендер на стеклянные перегородки',
      activity: 'Установка перегородок',
    });
    expect([...terms]).toEqual(['стеклянные']);
    expect(terms.has('ограждения')).toBe(false);
    expect(terms.has('тендер')).toBe(false);
  });
});
