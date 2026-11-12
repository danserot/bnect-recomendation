import type { PriceAggregate, Purchase, PurchaseAnalytics } from '@bnect/shared';
import PriceChart from './PriceChart';
import { dateLabel, money, numeric } from './format';

interface PurchaseComparisonProps {
  data: PurchaseAnalytics;
  region: string;
  comparisonRegion: string;
  requestKey: string;
  searchQuery: string;
  showChart: boolean;
  onToggleChart: () => void;
}

export default function PurchaseComparison({
  data,
  region,
  comparisonRegion,
  requestKey,
  searchQuery,
  showChart,
  onToggleChart,
}: PurchaseComparisonProps) {
  return (
    <section
      className={`panel purchase-analysis ${showChart ? '' : 'purchase-analysis-collapsed'}`}
      aria-label="Сравнение цен"
    >
      <div className="purchase-analysis-heading">
        <div>
          <span className="eyebrow">Сопоставимые закупки</span>
          <h2>Цена и средняя за период</h2>
        </div>
        <button
          className="purchase-chart-toggle"
          type="button"
          aria-expanded={showChart}
          aria-controls="purchase-price-history"
          onClick={onToggleChart}
        >
          {showChart ? 'Скрыть график' : 'Показать график'}
        </button>
      </div>
      <div className="purchase-metrics">
        <div className="purchase-metric purchase-metric-selected">
          <span>Цена выбранной закупки</span>
          <strong>
            {data.selected ? money(data.selected.unitPrice, data.selected.currency) : '—'}
          </strong>
          <small>
            {data.selected
              ? `№ ${data.selected.number} · ${data.selected.unit ?? 'единица не указана'}`
              : 'Выберите строку в каталоге'}
          </small>
        </div>
        <Metric
          label={`Средняя цена · ${region || 'все регионы'}`}
          aggregate={data.main}
          selected={data.selected}
          className="purchase-metric-average"
          reason={data.reason}
          selectedOnly={data.mainIncludesSelected}
        />
        {comparisonRegion && data.comparison && (
          <Metric
            label={`Средняя цена · ${comparisonRegion}`}
            aggregate={data.comparison}
            selected={data.selected}
          />
        )}
        <div
          className={`purchase-difference ${data.difference !== null && data.difference < 0 ? 'lower' : ''}`}
        >
          {data.mainIncludesSelected
            ? 'Средняя равна выбранной цене: для сравнения в основной группе нужна ещё одна закупка'
            : differenceLabel(data.difference)}
        </div>
        <p className="small muted">
          Период:{' '}
          {data.period.from
            ? `${dateLabel(data.period.from)} – ${dateLabel(data.period.to)}`
            : 'все даты из файла'}
          .{' '}
          {data.mainIncludesSelected
            ? 'Основная средняя рассчитана по выбранной закупке; из дополнительной группы она исключена.'
            : 'Выбранная закупка исключена из обеих групп.'}
        </p>
        {data.selected && (
          <p className="small muted">
            {[data.selected.vat, data.selected.priceKind, data.selected.characteristics]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {data.selected?.source.currencyBasis === 'user-confirmed' && (
          <p className="small muted">
            Валюта {data.selected.currency} подтверждена владельцем выгрузки; в исходном файле
            столбца валюты нет.
          </p>
        )}
      </div>
      <div id="purchase-price-history" hidden={!showChart}>
        {showChart && (
          <PriceChart
            key={requestKey}
            data={data}
            region={region}
            comparisonRegion={comparisonRegion}
            searchQuery={searchQuery}
          />
        )}
      </div>
    </section>
  );
}

function differenceLabel(difference: number | null) {
  if (difference === null) return 'Недостаточно данных для сравнения';
  if (Math.abs(difference) < 0.005) return 'Цена совпадает со средней ценой похожих закупок';
  const direction = difference > 0 ? 'дороже' : 'дешевле';
  return `На ${numeric(Math.abs(difference))}% ${direction} средней цены похожих закупок`;
}

function Metric({
  label,
  aggregate,
  selected,
  className = '',
  reason,
  selectedOnly = false,
}: {
  label: string;
  aggregate: PriceAggregate;
  selected: Purchase | null;
  className?: string;
  reason?: string | null;
  selectedOnly?: boolean;
}) {
  return (
    <div className={`purchase-metric ${className}`}>
      <span>{label}</span>
      <strong>{money(aggregate.price, selected?.currency ?? null)}</strong>
      <small>
        {selectedOnly
          ? 'Только 1 запись — выбранная закупка'
          : aggregate.count === 1
            ? 'Только 1 сопоставимая закупка'
            : aggregate.count
              ? `${aggregate.count} записей · ${selected?.unit ?? 'ед.'}`
              : reason || (selected ? 'Нет сопоставимых записей' : 'Выберите строку в каталоге')}
      </small>
      {selectedOnly && (
        <small>Средняя по одной цене равна этой цене. В основной группе других цен нет.</small>
      )}
      {selectedOnly && reason && <small>{reason}</small>}
      {aggregate.method && !selectedOnly && (
        <small>
          {aggregate.method === 'weighted'
            ? `Средневзвешенная · объём ${numeric(aggregate.volume)} ${selected?.unit ?? ''}`
            : 'Среднее арифметическое · количество известно не для всех записей'}
        </small>
      )}
    </div>
  );
}
