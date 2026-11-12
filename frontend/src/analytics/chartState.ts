import type { PriceBucket, PurchaseAnalytics } from '@bnect/shared';

export interface SeriesCoverage {
  total: number;
  filled: number;
  missing: number;
  datedRows: number;
}

export interface PriceChartState {
  visible: boolean;
  reason: 'select' | 'price' | 'empty' | 'single' | 'gaps' | 'complete';
  explanation: string;
  main: SeriesCoverage;
  comparison: SeriesCoverage | null;
}

function coverage(buckets: PriceBucket[], group: 'main' | 'comparison'): SeriesCoverage {
  let filled = 0;
  let datedRows = 0;
  for (const bucket of buckets) {
    const aggregate = bucket[group];
    if (
      aggregate &&
      aggregate.price !== null &&
      Number.isFinite(aggregate.price) &&
      aggregate.price > 0 &&
      aggregate.count > 0
    ) {
      filled++;
      datedRows += aggregate.count;
    }
  }
  return { total: buckets.length, filled, missing: buckets.length - filled, datedRows };
}

/** Only observed, dated comparable prices belong on the chart. Missing intervals stay empty. */
export function priceChartState(
  data: PurchaseAnalytics,
  comparisonRegion: string,
): PriceChartState {
  const main = coverage(data.buckets, 'main');
  const comparison = comparisonRegion ? coverage(data.buckets, 'comparison') : null;
  const result = (reason: PriceChartState['reason'], explanation: string): PriceChartState => ({
    visible: reason === 'single' || reason === 'gaps' || reason === 'complete',
    reason,
    explanation,
    main,
    comparison,
  });
  if (!data.selected)
    return result(
      'select',
      'Выберите закупку в каталоге, чтобы увидеть её цену, среднюю и доступную историю.',
    );
  if (
    data.selected.unitPrice === null ||
    !Number.isFinite(data.selected.unitPrice) ||
    data.selected.unitPrice <= 0
  )
    return result(
      'price',
      'У выбранной закупки нет корректной цены за единицу. Общая сумма документа её не заменяет.',
    );
  if (main.filled === 0 && (!comparison || comparison.filled === 0))
    return result(
      'empty',
      data.mainIncludesSelected
        ? 'Средняя по одной выбранной цене рассчитана. Без даты эту точку нельзя показать на графике.'
        : data.reason && data.reason !== 'Недостаточно данных для сравнения'
          ? data.reason
          : 'После фильтров и исключения выбранного документа не осталось сопоставимых закупок с датой и ценой.',
    );
  const notes: string[] = [];
  if (data.mainIncludesSelected)
    notes.push(
      'Средняя рассчитана по единственной выбранной цене. Одна точка не показывает динамику.',
    );
  if (!data.selected.date)
    notes.push('У выбранной закупки нет даты, поэтому её цена не отмечена на оси.');
  if (data.undated > 0)
    notes.push(
      `Записей без даты: ${data.undated}. Они входят в среднюю за весь период, но не в график.`,
    );
  for (const [series, label] of [
    [main, 'Основной регион'],
    ...(comparison ? [[comparison, `Дополнительный регион (${comparisonRegion})`] as const] : []),
  ] as const) {
    if (series.filled === 0) notes.push(`${label}: нет датированных цен в выбранном периоде.`);
    else if (series.filled === 1 && !(data.mainIncludesSelected && label === 'Основной регион'))
      notes.push(
        `${label}: ${series.filled} из ${series.total} интервалов. Одна точка не показывает динамику.`,
      );
    else if (series.missing > 0)
      notes.push(
        `${label}: ${series.filled} из ${series.total} интервалов. Пропуски оставлены пустыми.`,
      );
  }
  if (notes.length)
    return result(
      main.filled + (comparison?.filled ?? 0) === 1 ? 'single' : 'gaps',
      notes.join(' '),
    );
  return result(
    'complete',
    'Для каждого интервала выбранного периода есть сопоставимые цены. Полнота относится к загруженным данным Excel.',
  );
}
