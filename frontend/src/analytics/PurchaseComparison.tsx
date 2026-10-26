import type { PriceAggregate, Purchase, PurchaseAnalytics } from '@bnect/shared';
import PriceChart from './PriceChart';
import { dateLabel, money, numeric } from './format';

interface PurchaseComparisonProps {
  data: PurchaseAnalytics;
  region: string;
  comparisonRegion: string;
  requestKey: string;
  searchQuery: string;
}

export default function PurchaseComparison({
  data,
  region,
  comparisonRegion,
  requestKey,
  searchQuery,
}: PurchaseComparisonProps) {
  return (
    <section className="panel purchase-analysis" aria-label="Сравнение цен">
      <div className="purchase-metrics">
        <h2>Цена за единицу</h2>
        <div className="purchase-metric">
          <span>Выбранная закупка</span>
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
          label={`Средняя цена по данным Excel${region ? ` · ${region}` : ''}`}
          aggregate={data.main}
          selected={data.selected}
        />
        {comparisonRegion && data.comparison && (
          <Metric
            label={`Сравнение · ${comparisonRegion}`}
            aggregate={data.comparison}
            selected={data.selected}
          />
        )}
        <div
          className={`purchase-difference ${data.difference !== null && data.difference < 0 ? 'lower' : ''}`}
        >
          {differenceLabel(data.difference)}
        </div>
        <p className="small muted">
          Период:{' '}
          {data.period.from
            ? `${dateLabel(data.period.from)} – ${dateLabel(data.period.to)}`
            : 'все даты из файла'}
          . Выбранная закупка исключена из обеих групп.
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
      <PriceChart
        key={requestKey}
        data={data}
        comparisonRegion={comparisonRegion}
        searchQuery={searchQuery}
      />
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
}: {
  label: string;
  aggregate: PriceAggregate;
  selected: Purchase | null;
}) {
  return (
    <div className="purchase-metric">
      <span>{label}</span>
      <strong>{money(aggregate.price, selected?.currency ?? null)}</strong>
      <small>
        {aggregate.count
          ? `${aggregate.count} записей · ${selected?.unit ?? 'ед.'}`
          : 'Нет сопоставимых записей'}
      </small>
      {aggregate.method && (
        <small>
          {aggregate.method === 'weighted'
            ? `Средневзвешенная · объём ${numeric(aggregate.volume)} ${selected?.unit ?? ''}`
            : 'Среднее арифметическое · количество известно не для всех записей'}
        </small>
      )}
    </div>
  );
}
