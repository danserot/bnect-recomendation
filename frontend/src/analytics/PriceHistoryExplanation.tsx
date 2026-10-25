import type { PurchaseAnalytics } from '@bnect/shared';
import type { PriceChartState } from './chartState';
import { dateLabel, money, numeric } from './format';

export default function PriceHistoryExplanation({
  data,
  state,
  comparisonRegion,
  searchQuery,
}: {
  data: PurchaseAnalytics;
  state: PriceChartState;
  comparisonRegion: string;
  searchQuery: string;
}) {
  const selected = data.selected;
  if (!selected) return null;
  return (
    <details className="purchase-chart-breakdown" open={!state.visible}>
      <summary>Разбор выбранной закупки</summary>
      <ol>
        <li>
          Выбрана закупка <strong>№ {selected.number}</strong> от {dateLabel(selected.date)}:{' '}
          {money(selected.unitPrice, selected.currency)} / {selected.unit ?? 'единица не указана'}.{' '}
          {selected.product ?? selected.title}
          {selected.code ? ` · код ${selected.code}` : ''}.
        </li>
        <li>
          Выбранный документ всегда исключается из сравнения. В расчёт средней основного региона
          попало строк: <strong>{numeric(data.main.count, 0)}</strong>, с датой —{' '}
          <strong>{numeric(state.main.datedRows, 0)}</strong>. Совпадать должны товар, единица,
          валюта, НДС и вид цены; применяются регион и период.
        </li>
        <li>
          Период:{' '}
          {data.period.from
            ? `${dateLabel(data.period.from)} – ${dateLabel(data.period.to)}`
            : 'все даты из файла'}
          . Группировка —{' '}
          {data.period.grouping === 'day'
            ? 'по дням'
            : data.period.grouping === 'week'
              ? 'по неделям'
              : 'по месяцам'}
          . Заполнено интервалов основного региона:{' '}
          <strong>
            {state.main.filled} из {state.main.total}
          </strong>
          {state.comparison && (
            <>
              ; дополнительного региона —{' '}
              <strong>
                {state.comparison.filled} из {state.comparison.total}
              </strong>
            </>
          )}
          .
        </li>
      </ol>
      {searchQuery && (
        <p className="purchase-chart-search-note">
          Поиск «{searchQuery}» также ограничивает сравнительную выборку. Если искать один номер,
          после исключения выбранного документа может не остаться других закупок. Для истории товара
          используйте фильтр товара.
        </p>
      )}
      {data.buckets.length > 0 && (
        <div className="purchase-history-table-scroll">
          <table className="purchase-history-table">
            <caption>Интервалы расчёта для этой закупки</caption>
            <thead>
              <tr>
                <th scope="col">Интервал</th>
                <th scope="col">Основной регион</th>
                <th scope="col">Строк</th>
                {comparisonRegion && (
                  <>
                    <th scope="col">{comparisonRegion}</th>
                    <th scope="col">Строк</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {data.buckets.map((bucket) => (
                <tr key={bucket.from}>
                  <th scope="row">
                    {dateLabel(bucket.from)}
                    {bucket.to !== bucket.from ? ` – ${dateLabel(bucket.to)}` : ''}
                  </th>
                  <td>
                    {bucket.main.price === null
                      ? 'Нет данных'
                      : money(bucket.main.price, selected.currency)}
                  </td>
                  <td>{bucket.main.count}</td>
                  {comparisonRegion && (
                    <>
                      <td>
                        {bucket.comparison?.price === null || !bucket.comparison
                          ? 'Нет данных'
                          : money(bucket.comparison.price, selected.currency)}
                      </td>
                      <td>{bucket.comparison?.count ?? 0}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="purchase-chart-rule">
        График показывается, когда заполнены все интервалы и их не меньше двух. При пробелах можно
        изменить период или фильтры. Недостающие цены автоматически не восстанавливаются.
      </p>
    </details>
  );
}
