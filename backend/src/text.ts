import { createHash } from 'node:crypto';
import type { SupplierProfile, Tender } from '@bnect/shared';

export const SEMANTIC_TEXT_VERSION = 'work-scope-v2';
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
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
  return [
    `Работы или поставки: ${normalize(tender.activity)}`,
    `Сфера: ${normalize(tender.industryGroup)}`,
    `Наименование: ${workSubject(tender.title) || normalize(tender.activity)}`,
    `Вид закупки: ${normalize(tender.procurementType)}`,
    ...(tender.description?.trim() ? [`Описание: ${normalize(tender.description)}`] : []),
  ].join('\n');
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
