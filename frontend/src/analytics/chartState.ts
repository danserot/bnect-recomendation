import type { PriceBucket, PurchaseAnalytics } from '@bnect/shared';

export interface SeriesCoverage {
  total: number;
  filled: number;
  missing: number;
  datedRows: number;
}

export interface PriceChartState {
  visible: boolean;
  reason: 'select' | 'date' | 'price' | 'undated' | 'empty' | 'single' | 'gaps' | 'complete';
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

/** A selected price or isolated observations cannot substitute for a complete time series. */
export function priceChartState(
  data: PurchaseAnalytics,
  comparisonRegion: string,
): PriceChartState {
  const main = coverage(data.buckets, 'main');
  const comparison = comparisonRegion ? coverage(data.buckets, 'comparison') : null;
  const result = (reason: PriceChartState['reason'], explanation: string): PriceChartState => ({
    visible: reason === 'complete',
    reason,
    explanation,
    main,
    comparison,
  });
  if (!data.selected)
    return result(
      'select',
      'Выберите закупку в каталоге. График появится, если для каждого интервала выбранного периода есть сопоставимые цены.',
    );
  if (!data.selected.date)
    return result('date', 'У выбранной закупки нет даты. Её нельзя разместить на временной оси.');
  if (
    data.selected.unitPrice === null ||
    !Number.isFinite(data.selected.unitPrice) ||
    data.selected.unitPrice <= 0
  )
    return result(
      'price',
      'У выбранной закупки нет корректной цены за единицу. Общая сумма документа её не заменяет.',
    );
  if (data.undated > 0)
    return result(
      'undated',
      `В сравнительной выборке есть строки без даты: ${data.undated}. Они входят в среднюю за весь период, но их нельзя разместить на временной оси, поэтому полный график не показывается.`,
    );
  if (main.filled === 0)
    return result(
      'empty',
      data.reason && data.reason !== 'Недостаточно данных для сравнения'
        ? data.reason
        : 'После фильтров и исключения выбранного документа не осталось сопоставимых закупок с датой и ценой.',
    );
  for (const [series, label] of [
    [main, 'Основной регион'],
    ...(comparison ? [[comparison, `Дополнительный регион (${comparisonRegion})`] as const] : []),
  ] as const) {
    if (series.filled < 2)
      return result(
        series.filled === 0 ? 'empty' : 'single',
        `${label}: цены есть только в ${series.filled} из ${series.total} интервалов. Для графика нужны хотя бы два интервала и данные в каждом интервале выбранного периода. Одиночная точка не показывается как история цены.`,
      );
    if (series.missing > 0)
      return result(
        'gaps',
        `${label}: заполнено ${series.filled} из ${series.total} интервалов; без данных — ${series.missing}. График скрыт, поскольку ряд неполный. Пропуски не заменяются нулями и не соединяются вымышленной линией.`,
      );
  }
  return result(
    'complete',
    'Для каждого интервала выбранного периода есть сопоставимые цены. Полнота относится к загруженным данным Excel.',
  );
}
