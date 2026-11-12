import { createHash } from 'node:crypto';
import type { SupplierProfile, Tender } from '@bnect/shared';
import { regions } from './data/regions.js';

export const SEMANTIC_TEXT_VERSION = 'full-row-v1';
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
const regionNames = new Map(regions.map(({ id, name }) => [id, name]));
/** Object names are presentation metadata, not the subject of the purchase. */
export function projectKey(title: string): string | undefined {
  const text = normalize(title);
  const match =
    /\s+(?:по\s+проект[уы]|для\s+(?:жк|бц|жм)|(?:жк|бц|жм|жилой\s+комплекс)(?=\s|[«"№:]))\s*/iu.exec(
      text,
    );
  return match
    ? text
        .slice(match.index)
        .replace(/^\s*(?:по\s+проект[уы]|для)\s*/iu, '')
        .toLocaleLowerCase('ru')
        .replace(/[«»"']/g, '')
        .replace(/^\s*(?:жк|бц|жм|жилой\s+комплекс)\s+/iu, '')
        .replace(/\s*[-–]?\s*\d+(?:[-.]\d+)*\s*[-–]?\s*(?:оч\.?|очеред[ьиь]|этап)\.?$/iu, '')
        .trim()
    : undefined;
}
export function workSubject(title: string): string {
  let text = normalize(title);
  const match =
    /\s+(?:по\s+проект[уы]|для\s+(?:жк|бц|жм)|(?:жк|бц|жм|жилой\s+комплекс)(?=\s|[«"№:]))\s*/iu.exec(
      text,
    );
  if (match && match.index > 6) text = text.slice(0, match.index);
  return text
    .replace(
      /^(?:(?:открытый|закрытый|повторный)\s+)?(?:тендер|конкурс|запрос\s+ценовых\s+предложений)\s*(?:на\s+)?/iu,
      '',
    )
    .replace(/\((?:СМР|ТМЗ|ТМЦ)(?:\s*\+\s*(?:СМР|ТМЗ|ТМЦ))*\)/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tenderText(tender: Tender): string {
  const fields = [
    ['Название', tender.title],
    [
      'Регион',
      tender.regionId ? (regionNames.get(tender.regionId) ?? tender.regionId) : 'Не указан',
    ],
    ['Сфера', tender.industryGroup],
    ['Деятельность', tender.activity],
    ['Вид закупки', tender.procurementType],
    ['Способ закупки', tender.procurementMethod],
    ['Дата создания', new Date(tender.createdAt).toISOString()],
    ['Статус', tender.status === 'open' ? 'Открыта' : tender.status === 'closed' ? 'Закрыта' : ''],
    [
      'Срок подачи заявок',
      tender.applicationDeadline ? new Date(tender.applicationDeadline).toISOString() : '',
    ],
    // Keep long descriptions last so they cannot displace the structured fields.
    ['Описание', tender.description],
  ];
  return fields
    .filter(([, value]) => value?.trim())
    .map(([label, value]) => `${label}: ${normalize(value!)}`)
    .join('\n');
}

export function supplierText(profile: SupplierProfile): string {
  // IDs, company name and geography are deliberately excluded from semantic search.
  return [
    `Специализация: ${profile.specializationDescription.trim()}`,
    `Сфера: ${[...profile.industryGroups].sort().join('; ')}`,
    `Деятельность: ${[...profile.activities].sort().join('; ')}`,
    `Вид закупки: ${[...profile.procurementTypes].sort().join('; ')}`,
  ].join('\n');
}

export const contentHash = (text: string) => createHash('sha256').update(text).digest('hex');
