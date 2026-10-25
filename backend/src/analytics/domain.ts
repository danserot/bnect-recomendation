import { createHash } from 'node:crypto';
import type { PriceAggregate, Purchase } from '@bnect/shared';

export const normalize = (value: string) =>
  value.normalize('NFKC').trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');

/** A category code or similar title alone is not evidence of equal goods. */
export function productKey(purchase: Purchase): string | null {
  if (purchase.comparisonGroup) return `confirmed:${normalize(purchase.comparisonGroup)}`;
  if (purchase.identityKind === 'nomenclature' && purchase.code && purchase.product)
    return JSON.stringify(['nomenclature', normalize(purchase.code), normalize(purchase.product)]);
  if (!purchase.characteristics || (!purchase.code && !purchase.product)) return null;
  return JSON.stringify([
    purchase.code ? `code:${normalize(purchase.code)}` : `product:${normalize(purchase.product!)}`,
    normalize(purchase.characteristics),
  ]);
}

export function comparisonProblem(purchase: Purchase): string | null {
  if (!productKey(purchase))
    return 'Для сравнения нужны характеристики и код/товар либо явно подтверждённая группа сравнения.';
  const missing = [
    !purchase.unit && 'единица измерения',
    !purchase.currency && 'валюта',
    !purchase.vat && 'режим НДС',
    !purchase.priceKind && 'вид цены (плановая/фактическая)',
  ].filter(Boolean);
  if (missing.length) return `Не подтверждены условия цены: ${missing.join(', ')}.`;
  if (!purchase.unitPrice) return 'В выбранной закупке нет корректной цены за единицу.';
  return null;
}

export function compatibilityKey(purchase: Purchase): string | null {
  if (comparisonProblem(purchase)) return null;
  return JSON.stringify(
    [productKey(purchase), purchase.unit, purchase.currency, purchase.vat, purchase.priceKind].map(
      (value) => normalize(value!),
    ),
  );
}

export function purchaseId(purchase: Omit<Purchase, 'id'>): string {
  const { source: _source, ...content } = purchase;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

export function priceDifference(price: number | null, mean: number | null): number | null {
  if (price === null || mean === null || mean <= 0) return null;
  const result = (price / mean - 1) * 100;
  return Number.isFinite(result) ? result : null;
}

export const emptyAggregate = (): PriceAggregate => ({
  price: null,
  count: 0,
  volume: null,
  method: null,
});
