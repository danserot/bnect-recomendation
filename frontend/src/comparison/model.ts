import type { Tender } from '@bnect/shared';

export type ComparedField =
  | 'activity'
  | 'regionId'
  | 'industryGroup'
  | 'procurementType'
  | 'procurementMethod';

export const comparedFields: { key: ComparedField; label: string }[] = [
  { key: 'activity', label: 'Вид работ / поставок' },
  { key: 'regionId', label: 'Регион' },
  { key: 'industryGroup', label: 'Сфера' },
  { key: 'procurementType', label: 'Вид закупки' },
  { key: 'procurementMethod', label: 'Способ закупки' },
];

export function normalizedField(value: string | null | undefined): string {
  const normalized = (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru');
  return /^[\s—–-]*$/.test(normalized) ? '' : normalized;
}

export function fieldsMatch(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  const value = normalizedField(first);
  return Boolean(value) && value === normalizedField(second);
}

export function activityPriority(
  source: Tender,
  candidate: Tender,
): 'same' | 'fallback' | 'unspecified' {
  if (!normalizedField(source.activity)) return 'unspecified';
  return fieldsMatch(source.activity, candidate.activity) ? 'same' : 'fallback';
}

export function dateGap(source: string, candidate: string): { label: string; direction: string } {
  const delta = Date.parse(candidate) - Date.parse(source);
  if (!Number.isFinite(delta)) return { label: 'Дата не указана', direction: '' };
  if (delta === 0) return { label: 'Та же дата и время', direction: '' };
  const absolute = Math.abs(delta);
  const unit =
    absolute >= 86_400_000 ? 'дн.' : absolute >= 3_600_000 ? 'ч' : absolute >= 60_000 ? 'мин' : 'с';
  const divisor =
    absolute >= 86_400_000
      ? 86_400_000
      : absolute >= 3_600_000
        ? 3_600_000
        : absolute >= 60_000
          ? 60_000
          : 1000;
  const amount = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(
    absolute / divisor,
  );
  return {
    label: `${amount} ${unit}`,
    direction: delta < 0 ? 'раньше исходного' : 'позже исходного',
  };
}

const genericWords = new Set([
  'открытый',
  'закрытый',
  'повторный',
  'тендер',
  'конкурс',
  'запрос',
  'ценовых',
  'предложений',
  'проект',
  'проекту',
  'проекта',
  'работы',
  'работ',
  'работам',
  'поставка',
  'поставки',
  'услуги',
  'услуг',
  'для',
  'при',
  'или',
  'смр',
  'тмз',
  'тмц',
]);

function meaningfulWords(value: string): string[] {
  return (value.match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((word) => word.toLocaleLowerCase('ru'))
    .filter((word) => word.length >= 3 && /\p{L}/u.test(word) && !genericWords.has(word));
}

/** Literal overlaps are reading aids, never an explanation of the semantic score. */
export function sharedTerms(source: Tender, candidate: Tender): Set<string> {
  const text = (tender: Tender) => `${tender.title} ${tender.activity} ${tender.description ?? ''}`;
  const reference = new Set(meaningfulWords(text(source)));
  return new Set(meaningfulWords(text(candidate)).filter((word) => reference.has(word)));
}
