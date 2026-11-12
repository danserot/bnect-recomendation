import type { PurchaseOptions } from '@bnect/shared';
import type { PurchaseFilterValues } from './usePurchaseAnalytics';
import { useProductSearch } from './useProductSearch';
import { Icon } from '../ui';

interface PurchaseFiltersProps {
  options: PurchaseOptions;
  filters: PurchaseFilterValues;
  effectivePeriod: string;
  onChange: (change: Partial<PurchaseFilterValues>) => void;
  onComparisonChange: (region: string) => void;
  onReset: () => void;
}

export default function PurchaseFilters({
  options,
  filters,
  effectivePeriod,
  onChange,
  onComparisonChange,
  onReset,
}: PurchaseFiltersProps) {
  const { product, region, status, comparisonRegion } = filters;
  const {
    search: productSearch,
    setSearch: setProductSearch,
    matches: productMatches,
    error: productSearchError,
  } = useProductSearch();
  const productOptions = [
    ...new Set([
      ...(product ? [product] : []),
      ...(productSearch.length >= 2 ? productMatches : options.products),
    ]),
  ];

  return (
    <section className="panel purchase-filters" aria-label="Фильтры аналитики">
      <div className="purchase-filter-heading">
        <h2>
          <Icon name="filter" size={18} /> Параметры анализа
        </h2>
        <button
          className="text-button"
          onClick={() => {
            setProductSearch('');
            onReset();
          }}
        >
          Сбросить фильтры
        </button>
      </div>
      <div className="purchase-filter-grid">
        <label className="field purchase-search">
          <span>Поиск</span>
          <input
            className="control"
            type="search"
            placeholder="Название, код или номер закупки"
            value={filters.query}
            onChange={(e) => onChange({ query: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Найти товар</span>
          <input
            className="control"
            placeholder="Не менее 2 символов"
            value={productSearch}
            disabled={!options.total}
            onChange={(e) => setProductSearch(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Товар</span>
          <select
            className="control"
            disabled={!options.products.length}
            value={product}
            onChange={(e) => onChange({ product: e.target.value })}
          >
            <option value="">Все товары</option>
            {productOptions.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Основной регион</span>
          <select
            className="control"
            disabled={!options.regions.length}
            value={region}
            onChange={(event) => onChange({ region: event.target.value })}
          >
            <option value="">Все регионы</option>
            {options.regions.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Период</span>
          <select
            className="control"
            value={effectivePeriod}
            disabled={!!options.total && !options.dated}
            onChange={(e) => onChange({ period: e.target.value })}
          >
            {[
              ['1', '1 месяц'],
              ['3', '3 месяца'],
              ['6', '6 месяцев'],
              ['12', '12 месяцев'],
              ['all', 'Весь период'],
            ].map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {options.fields.includes('status') && (
          <label className="field">
            <span>Статус</span>
            <select
              className="control"
              value={status}
              onChange={(e) => onChange({ status: e.target.value })}
            >
              <option value="">Все статусы</option>
              {options.statuses.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Дополнительная группа сравнения</span>
          <select
            className="control"
            value={comparisonRegion}
            disabled={!region}
            onChange={(event) => onComparisonChange(event.target.value)}
          >
            <option value="">Не выбрана</option>
            {options.regions
              .filter((v) => v !== region)
              .map((v) => (
                <option key={v}>{v}</option>
              ))}
          </select>
        </label>
      </div>
      {options.productsTruncated && !productSearch && (
        <small className="muted">Показаны первые 200 товаров. Используйте поиск товара.</small>
      )}
      {productSearchError && <small role="alert">{productSearchError}</small>}
      <div className="purchase-filter-foot">
        <Icon name="info" size={15} />
        <span>
          Регион и период применяются до расчёта. Дополнительный регион включается вручную.
        </span>
      </div>
    </section>
  );
}
