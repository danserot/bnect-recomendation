import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PriceAggregate, Purchase, PurchaseAnalytics } from '@bnect/shared';
import { priceChartState } from '../../frontend/src/analytics/chartState.js';
import PriceChart from '../../frontend/src/analytics/PriceChart.js';

const selected: Purchase = {
  id: 'example',
  number: 'EXAMPLE-SELECTED',
  title: 'Условный товар',
  product: 'Условный товар',
  code: 'EXAMPLE-SKU',
  characteristics: 'Условная спецификация',
  comparisonGroup: null,
  date: '2026-09-15',
  region: 'Астана',
  quantity: 10,
  unit: 'шт',
  unitPrice: 120,
  amount: 1200,
  currency: 'KZT',
  vat: 'без НДС',
  priceKind: 'фактическая',
  status: null,
  priceDerived: false,
  source: { file: 'synthetic.xlsx', sheet: 'Пример', row: 2 },
};
const aggregate = (prices: (number | null)[]): PriceAggregate => {
  const values = prices.filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  return {
    price: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    count: values.length,
    volume: values.length ? values.length * 10 : null,
    method: values.length ? 'weighted' : null,
  };
};
function history(prices: (number | null)[], comparison?: (number | null)[]): PurchaseAnalytics {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    selected: { ...selected },
    main: aggregate(prices),
    comparison: comparison ? aggregate(comparison) : null,
    difference: null,
    reason: null,
    period: { from: '2026-07-01', to: '2026-09-30', grouping: 'month' },
    undated: 0,
    buckets: prices.map((price, index) => ({
      from: new Date(Date.UTC(2026, 6 + index, 1)).toISOString().slice(0, 10),
      to: new Date(Date.UTC(2026, 7 + index, 0)).toISOString().slice(0, 10),
      main: aggregate([price]),
      comparison: comparison ? aggregate([comparison[index]]) : null,
    })),
  };
}

describe('price chart completeness', () => {
  test('a selected price alone does not produce a graph or legend', () => {
    const data = history([null, null, null]);
    expect(priceChartState(data, '')).toMatchObject({
      visible: false,
      reason: 'empty',
      main: { filled: 0, missing: 3 },
    });
    const html = renderToStaticMarkup(createElement(PriceChart, { data, comparisonRegion: '' }));
    expect(html).not.toContain('purchase-chart-svg');
    expect(html).not.toContain('purchase-legend');
    expect(html).toContain('Разбор выбранной закупки');
    expect(html).toContain('EXAMPLE-SELECTED');
  });
  test('one interval cannot be presented as a price history', () => {
    expect(priceChartState(history([100]), '')).toMatchObject({ visible: false, reason: 'single' });
    expect(priceChartState(history([null, 100, null]), '')).toMatchObject({
      visible: false,
      reason: 'single',
    });
  });
  test.each([
    [null, 100, 120],
    [100, null, 120],
    [100, 120, null],
  ])('a missing boundary or internal interval hides the whole graph (%j)', (...prices) => {
    expect(priceChartState(history(prices), '')).toMatchObject({
      visible: false,
      reason: 'gaps',
      main: { total: 3, filled: 2, missing: 1, datedRows: 2 },
    });
  });
  test('every requested group must cover every interval', () => {
    expect(
      priceChartState(history([100, 110, 120], [200, null, 220]), 'Другой регион'),
    ).toMatchObject({ visible: false, reason: 'gaps' });
    expect(
      priceChartState(history([100, 110, 120], [200, 210, 220]), 'Другой регион'),
    ).toMatchObject({ visible: true, reason: 'complete' });
    expect(priceChartState(history([100, 110, 120], [200, null, 220]), '').visible).toBe(true);
  });
  test('missing dates or selected price prevent showing a complete chart', () => {
    const data = history([100, 110, 120]);
    expect(priceChartState({ ...data, selected: null }, '').reason).toBe('select');
    expect(priceChartState({ ...data, selected: { ...selected, date: null } }, '').reason).toBe(
      'date',
    );
    expect(
      priceChartState({ ...data, selected: { ...selected, unitPrice: null } }, '').reason,
    ).toBe('price');
    expect(priceChartState({ ...data, undated: 1 }, '').reason).toBe('undated');
    const invalid = history([100, 110, 120]);
    invalid.buckets[1].main.price = NaN;
    expect(priceChartState(invalid, '').visible).toBe(false);
  });
  test('a complete series renders a chart and a factual breakdown', () => {
    const data = history([100, 110, 120]);
    const html = renderToStaticMarkup(
      createElement(PriceChart, { data, comparisonRegion: '', searchQuery: 'EXAMPLE' }),
    );
    expect(html).toContain('purchase-chart-svg');
    expect(html).toContain('purchase-legend');
    expect(html).toContain('Интервалы расчёта для этой закупки');
    expect(html).toContain('Поиск «EXAMPLE» также ограничивает сравнительную выборку');
  });
});
