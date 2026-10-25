import { useState } from 'react';
import type { PurchaseAnalytics, PriceAggregate } from '@bnect/shared';
import { dateLabel, money, numeric } from './format';
import { priceChartState } from './chartState';
import PriceHistoryExplanation from './PriceHistoryExplanation';

export default function PriceChart({
  data,
  comparisonRegion,
  searchQuery = '',
}: {
  data: PurchaseAnalytics;
  comparisonRegion: string;
  searchQuery?: string;
}) {
  const [tooltip, setTooltip] = useState('');
  const selected = data.selected;
  const state = priceChartState(data, comparisonRegion);
  if (!state.visible)
    return (
      <div className="purchase-chart purchase-chart-unavailable">
        <div className="purchase-chart-message" role="status">
          <h2>{selected ? 'График не показан' : 'Выберите закупку для просмотра истории'}</h2>
          <p>{state.explanation}</p>
        </div>
        <PriceHistoryExplanation
          data={data}
          state={state}
          comparisonRegion={comparisonRegion}
          searchQuery={searchQuery}
        />
      </div>
    );
  const points = data.buckets
    .flatMap((b) => [b.main.price, b.comparison?.price ?? null])
    .filter((v): v is number => v !== null);
  if (selected?.unitPrice !== null && selected?.unitPrice !== undefined && selected.date)
    points.push(selected.unitPrice);
  const datePoints = data.buckets.map((b) => Date.parse(b.from));
  if (selected?.date) datePoints.push(Date.parse(selected.date));
  const width = 760,
    height = 290,
    left = 82,
    right = 24,
    top = 28,
    bottom = 44;
  const minX = Math.min(...datePoints),
    maxX = Math.max(...datePoints, data.buckets.length ? Date.parse(data.buckets.at(-1)!.to) : 0);
  const minY = Math.max(0, Math.min(...points) * 0.85),
    maxY = Math.max(...points) * 1.15;
  const x = (day: string) =>
    left + ((Date.parse(day) - minX) / Math.max(86400000, maxX - minX)) * (width - left - right);
  const y = (value: number) =>
    height - bottom - ((value - minY) / Math.max(1e-9, maxY - minY)) * (height - top - bottom);
  const describe = (from: string, to: string, aggregate: PriceAggregate, label: string) =>
    `${label}. ${dateLabel(from)}${from !== to ? ` – ${dateLabel(to)}` : ''}: ${money(aggregate.price, selected?.currency ?? null)} / ${selected?.unit ?? 'ед.'}. Записей: ${aggregate.count}. ${aggregate.volume !== null ? `Объём: ${numeric(aggregate.volume)} ${selected?.unit ?? ''}. ` : ''}${aggregate.method === 'weighted' ? 'Средневзвешенная цена' : 'Среднее арифметическое'}.`;
  function path(group: 'main' | 'comparison') {
    let drawing = false;
    return data.buckets
      .map((b) => {
        const value = b[group]?.price;
        if (value === null || value === undefined) {
          drawing = false;
          return '';
        }
        const command = `${drawing ? 'L' : 'M'}${x(b.from)},${y(value)}`;
        drawing = true;
        return command;
      })
      .join(' ');
  }
  return (
    <div className="purchase-chart">
      <div className="purchase-chart-heading">
        <div>
          <h2>Динамика средней цены</h2>
          <p className="small muted">
            {selected?.currency ?? 'Валюта'} / {selected?.unit ?? 'единица товара'} ·{' '}
            {data.period.grouping === 'day'
              ? 'по дням'
              : data.period.grouping === 'week'
                ? 'по неделям'
                : 'по месяцам'}
          </p>
        </div>
      </div>
      <>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="purchase-chart-svg"
          role="group"
          aria-label="График цены за единицу товара по датам"
        >
          {[0, 1, 2, 3, 4].map((i) => {
            const value = minY + ((maxY - minY) * i) / 4;
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="#e2e7ed"
                  strokeDasharray="4 5"
                />
                <text x={left - 12} y={y(value) + 4} textAnchor="end">
                  {new Intl.NumberFormat('ru-RU', {
                    notation: 'compact',
                    maximumFractionDigits: 1,
                  }).format(value)}
                </text>
              </g>
            );
          })}
          {[0, 1, 2, 3, 4].map((i) => {
            const timestamp = minX + ((maxX - minX) * i) / 4;
            return (
              <text
                key={i}
                x={left + ((width - left - right) * i) / 4}
                y={height - 14}
                textAnchor="middle"
              >
                {new Intl.DateTimeFormat('ru-RU', {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                }).format(timestamp)}
              </text>
            );
          })}
          <path d={path('main')} fill="none" stroke="#3478db" strokeWidth="2.5" />
          {comparisonRegion && (
            <path d={path('comparison')} fill="none" stroke="#8fc4f5" strokeWidth="2.5" />
          )}
          {data.buckets.flatMap((b) =>
            (['main', 'comparison'] as const).map((group) => {
              const aggregate = b[group];
              if (!aggregate?.price) return null;
              const label = describe(
                b.from,
                b.to,
                aggregate,
                group === 'main' ? 'Основной регион' : comparisonRegion,
              );
              return (
                <circle
                  key={`${b.from}:${group}`}
                  cx={x(b.from)}
                  cy={y(aggregate.price)}
                  r="4"
                  fill={group === 'main' ? '#3478db' : '#8fc4f5'}
                  tabIndex={0}
                  aria-label={label}
                  onMouseEnter={() => setTooltip(label)}
                  onMouseLeave={() => setTooltip('')}
                  onFocus={() => setTooltip(label)}
                  onBlur={() => setTooltip('')}
                >
                  <title>{label}</title>
                </circle>
              );
            }),
          )}
          {selected?.date && selected.unitPrice !== null && (
            <circle
              cx={x(selected.date)}
              cy={y(selected.unitPrice)}
              r="6"
              fill="#2b9d68"
              stroke="white"
              strokeWidth="2"
              tabIndex={0}
              aria-label={`Выбранная закупка ${selected.number}: ${money(selected.unitPrice, selected.currency)}, ${dateLabel(selected.date)}`}
              onMouseEnter={() =>
                setTooltip(
                  `Закупка ${selected.number}. ${dateLabel(selected.date)}: ${money(selected.unitPrice, selected.currency)} / ${selected.unit ?? 'ед.'}.`,
                )
              }
              onMouseLeave={() => setTooltip('')}
              onFocus={() =>
                setTooltip(
                  `Закупка ${selected.number}. ${dateLabel(selected.date)}: ${money(selected.unitPrice, selected.currency)}.`,
                )
              }
              onBlur={() => setTooltip('')}
            >
              <title>{`${selected.number}: ${dateLabel(selected.date)}, ${money(selected.unitPrice, selected.currency)}`}</title>
            </circle>
          )}
        </svg>
        <div className="purchase-chart-tooltip" role="status">
          {tooltip || 'Наведите на точку или выберите её клавишей Tab, чтобы увидеть расчёт.'}
        </div>
      </>
      <div className="purchase-legend">
        <span>
          <i style={{ background: '#3478db' }} />
          Основной регион
        </span>
        {comparisonRegion && (
          <span>
            <i style={{ background: '#8fc4f5' }} />
            {comparisonRegion}
          </span>
        )}
        <span>
          <i style={{ background: '#2b9d68' }} />
          Выбранная закупка
        </span>
      </div>
      <p className="purchase-chart-completeness">{state.explanation}</p>
      <PriceHistoryExplanation
        data={data}
        state={state}
        comparisonRegion={comparisonRegion}
        searchQuery={searchQuery}
      />
    </div>
  );
}
