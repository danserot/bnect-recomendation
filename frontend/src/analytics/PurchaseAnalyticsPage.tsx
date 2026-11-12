import { useState } from 'react';
import { Loading, Notice } from '../ui';
import PurchaseFilters from './PurchaseFilters';
import PurchaseCatalog from './PurchaseCatalog';
import PurchaseComparison from './PurchaseComparison';
import { EMPTY_PURCHASE_OPTIONS, usePurchaseAnalytics } from './usePurchaseAnalytics';
import { numeric } from './format';
import './analytics.css';

export default function PurchaseAnalyticsPage() {
  const [showChart, setShowChart] = useState(true);
  const {
    options,
    filters,
    effectivePeriod,
    requestKey,
    data,
    error,
    updateFilters,
    resetFilters,
    choosePurchase,
    clearSelection,
    setComparisonRegion,
    setPage,
    retry,
  } = usePurchaseAnalytics();
  const meta = options ?? EMPTY_PURCHASE_OPTIONS;

  return (
    <div className="purchase-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Каталог и сравнение цен</span>
          <h1>Аналитика закупок</h1>
          <p className="subtitle">
            Средняя цена по данным Excel для сопоставимых товаров и условий закупки.
          </p>
        </div>
        <div className="heading-mark">
          <strong>{options ? numeric(options.total, 0) : '—'}</strong> записей в каталоге
        </div>
      </div>
      <PurchaseFilters
        options={meta}
        filters={filters}
        effectivePeriod={effectivePeriod}
        onChange={updateFilters}
        onComparisonChange={setComparisonRegion}
        onReset={resetFilters}
      />
      {error ? (
        <section className="panel panel-pad" role="alert">
          <h2>Не удалось загрузить аналитику</h2>
          <p>{error}</p>
          <button className="btn primary" onClick={retry}>
            Повторить
          </button>
        </section>
      ) : !data || !options ? (
        <section className="panel panel-pad" aria-busy="true">
          <Loading text="Загружаем каталог и рассчитываем показатели…" />
        </section>
      ) : (
        <>
          <PurchaseComparison
            data={data}
            region={filters.region}
            comparisonRegion={filters.comparisonRegion}
            requestKey={requestKey}
            searchQuery={filters.query}
            showChart={showChart}
            onToggleChart={() => setShowChart((value) => !value)}
          />
          <PurchaseCatalog
            data={data}
            fields={meta.fields}
            totalRecords={meta.total}
            onChoose={choosePurchase}
            onClearSelection={clearSelection}
            onPageChange={setPage}
          />
          {!!meta.total && !meta.dated && (
            <Notice>В Excel нет дат: временной график недоступен. Показан весь период.</Notice>
          )}
          {meta.fields.includes('unitPrice') && (
            <p className="small muted">
              * Цена рассчитана как общая сумма / количество. Общая сумма лота сама по себе не
              используется как цена за единицу.
            </p>
          )}
        </>
      )}
      <details className="purchase-method small muted">
        <summary>Как рассчитывается средняя цена</summary>
        <p>
          Сравниваются записи с одинаковыми характеристиками и кодом/товаром или явно подтверждённой
          группой сравнения. Единица, валюта, режим НДС и вид цены должны быть известны и совпадать.
          Плановые и фактические цены разделены. Выбранная закупка исключена, когда есть другие
          сопоставимые цены; если она единственная, средняя равна её цене и это явно указано.
          Учитываются все записи, прошедшие поиск, фильтры и проверку сопоставимости, включая другие
          страницы каталога.
        </p>
        <p>
          При полном количестве: Σ(цена × количество) / Σ(количество). Если количество указано не
          везде, используется среднее арифметическое всех корректных цен с явной отметкой. Без
          фильтра региона средняя рассчитывается по всем регионам. Записи без даты участвуют только
          при выборе всего периода. График показывает доступные датированные цены; пустые интервалы
          остаются пустыми. Его можно скрыть без изменения расчёта средней. Данные Excel не
          подтверждают среднерыночную цену.
        </p>
      </details>
    </div>
  );
}
