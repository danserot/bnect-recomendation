import { useEffect, useState } from 'react';
import type { PriceAggregate, Purchase, PurchaseAnalytics, PurchaseOptions } from '@bnect/shared';
import { api, errorMessage } from '../api';
import { Loading, Notice } from '../ui';
import PriceChart from './PriceChart';
import { dateLabel, money, numeric } from './format';
import './analytics.css';

const emptyOptions: PurchaseOptions = {
  total: 0,
  products: [],
  regions: [],
  statuses: [],
  fields: [],
  dated: 0,
};
export default function PurchaseAnalyticsPage() {
  const [options, setOptions] = useState<PurchaseOptions | null>(null);
  const [data, setData] = useState<{ key: string; value: PurchaseAnalytics } | null>(null);
  const [q, setQ] = useState(''),
    [product, setProduct] = useState(''),
    [region, setRegion] = useState('');
  const [period, setPeriod] = useState('6'),
    [status, setStatus] = useState(''),
    [comparison, setComparison] = useState('');
  const [selected, setSelected] = useState(''),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [productSearch, setProductSearch] = useState(''),
    [productMatches, setProductMatches] = useState<string[]>([]);
  const [productSearchError, setProductSearchError] = useState('');
  const effectivePeriod = options && options.total > 0 && options.dated === 0 ? 'all' : period;
  const params = new URLSearchParams({
    period: effectivePeriod,
    page: String(page),
    pageSize: '20',
  });
  for (const [key, value] of Object.entries({
    q,
    product,
    region,
    status,
    selectedId: selected,
    comparisonRegion: comparison,
  }))
    if (value) params.set(key, value);
  const queryString = params.toString();
  const requestKey = `${queryString}:${attempt}`;
  const current = data?.key === requestKey ? data.value : null;
  useEffect(() => {
    const controller = new AbortController();
    setProductMatches([]);
    setProductSearchError('');
    if (productSearch.trim().length < 2) return;
    const timer = setTimeout(() => {
      api
        .purchaseProducts(productSearch, controller.signal)
        .then((values) => {
          if (!controller.signal.aborted) setProductMatches(values);
        })
        .catch((problem) => {
          if (!controller.signal.aborted) setProductSearchError(errorMessage(problem));
        });
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [productSearch]);
  useEffect(() => {
    const controller = new AbortController();
    setOptions(null);
    api
      .purchaseOptions(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setOptions(value);
        }
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError(errorMessage(problem));
      });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    const timer = setTimeout(() => {
      api
        .purchaseAnalytics(new URLSearchParams(queryString), controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setData({ key: requestKey, value });
        })
        .catch((problem) => {
          if (!controller.signal.aborted) setError(errorMessage(problem));
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, queryString]);
  function filter(change: () => void) {
    setSelected('');
    setPage(1);
    change();
  }
  function choose(purchase: Purchase) {
    setSelected(purchase.id);
    if (!region && purchase.region) {
      setRegion(purchase.region);
      if (comparison === purchase.region) setComparison('');
      setPage(1);
    }
  }
  const meta = options ?? emptyOptions;
  const fields = meta.fields;
  const columns: [string, string, (p: Purchase) => string][] = [
    ['number', 'Номер', (p) => p.number],
    ['date', 'Дата', (p) => dateLabel(p.date)],
    ['title', 'Наименование', (p) => p.title],
    ['product', 'Товар / код', (p) => [p.product, p.code].filter(Boolean).join(' · ') || '—'],
    ['region', 'Регион', (p) => p.region ?? '—'],
    ['quantity', 'Количество', (p) => numeric(p.quantity)],
    ['unit', 'Единица', (p) => p.unit ?? '—'],
    [
      'unitPrice',
      'Цена за единицу',
      (p) => money(p.unitPrice, p.currency) + (p.priceDerived ? ' *' : ''),
    ],
    [
      'amount',
      'Сумма',
      (p) => money(p.amount, p.currency) + (p.amountVat ? ` (${p.amountVat})` : ''),
    ],
  ];
  const visibleColumns = columns.filter(
    ([key]) =>
      fields.includes(key) ||
      key === 'number' ||
      key === 'title' ||
      (key === 'product' && fields.includes('code')),
  );
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
      <section className="panel purchase-filters" aria-label="Фильтры аналитики">
        <label className="field purchase-search">
          <span>Поиск</span>
          <input
            className="control"
            type="search"
            placeholder="Название, код или номер закупки"
            value={q}
            onChange={(e) => filter(() => setQ(e.target.value))}
          />
        </label>
        <div className="field">
          <label className="field">
            <span>Найти товар</span>
            <input
              className="control"
              placeholder="Не менее 2 символов"
              value={productSearch}
              disabled={!meta.total}
              onChange={(e) => setProductSearch(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Товар</span>
            <select
              className="control"
              disabled={!meta.products.length}
              value={product}
              onChange={(e) => filter(() => setProduct(e.target.value))}
            >
              <option value="">Все товары</option>
              {[
                ...new Set([
                  ...(product ? [product] : []),
                  ...(productSearch.length >= 2 ? productMatches : meta.products),
                ]),
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          {meta.productsTruncated && !productSearch && (
            <small className="muted">Показаны первые 200 товаров. Используйте поиск товара.</small>
          )}
          {productSearchError && <small role="alert">{productSearchError}</small>}
        </div>
        <label className="field">
          <span>Основной регион</span>
          <select
            className="control"
            disabled={!meta.regions.length}
            value={region}
            onChange={(e) =>
              filter(() => {
                setRegion(e.target.value);
                if (comparison === e.target.value) setComparison('');
              })
            }
          >
            <option value="">Все регионы · без средней</option>
            {meta.regions.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Период</span>
          <select
            className="control"
            value={effectivePeriod}
            disabled={!!meta.total && !meta.dated}
            onChange={(e) => filter(() => setPeriod(e.target.value))}
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
        {fields.includes('status') && (
          <label className="field">
            <span>Статус</span>
            <select
              className="control"
              value={status}
              onChange={(e) => filter(() => setStatus(e.target.value))}
            >
              <option value="">Все статусы</option>
              {meta.statuses.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Дополнительная группа сравнения</span>
          <select
            className="control"
            value={comparison}
            disabled={!region}
            onChange={(e) => {
              setComparison(e.target.value);
            }}
          >
            <option value="">Не выбрана</option>
            {meta.regions
              .filter((v) => v !== region)
              .map((v) => (
                <option key={v}>{v}</option>
              ))}
          </select>
        </label>
        <div className="purchase-filter-foot">
          <span>
            Регион и период применяются до расчёта. Дополнительный регион включается вручную.
          </span>
          <button
            className="text-button"
            onClick={() =>
              filter(() => {
                setQ('');
                setProduct('');
                setProductSearch('');
                setRegion('');
                setStatus('');
                setPeriod('6');
                setComparison('');
              })
            }
          >
            Сбросить фильтры
          </button>
        </div>
      </section>
      {error ? (
        <section className="panel panel-pad" role="alert">
          <h2>Не удалось загрузить аналитику</h2>
          <p>{error}</p>
          <button className="btn primary" onClick={() => setAttempt((a) => a + 1)}>
            Повторить
          </button>
        </section>
      ) : !current || !options ? (
        <section className="panel panel-pad" aria-busy="true">
          <Loading text="Загружаем каталог и рассчитываем показатели…" />
        </section>
      ) : (
        <>
          <section className="panel purchase-analysis" aria-label="Сравнение цен">
            <div className="purchase-metrics">
              <h2>Цена за единицу</h2>
              <div className="purchase-metric">
                <span>Выбранная закупка</span>
                <strong>
                  {current.selected
                    ? money(current.selected.unitPrice, current.selected.currency)
                    : '—'}
                </strong>
                <small>
                  {current.selected
                    ? `№ ${current.selected.number} · ${current.selected.unit ?? 'единица не указана'}`
                    : 'Выберите строку в каталоге'}
                </small>
              </div>
              <Metric
                label={`Средняя цена по данным Excel${region ? ` · ${region}` : ''}`}
                aggregate={current.main}
                selected={current.selected}
              />
              {comparison && current.comparison && (
                <Metric
                  label={`Сравнение · ${comparison}`}
                  aggregate={current.comparison}
                  selected={current.selected}
                />
              )}
              <div
                className={`purchase-difference ${current.difference !== null && current.difference < 0 ? 'lower' : ''}`}
              >
                {current.difference === null
                  ? 'Недостаточно данных для сравнения'
                  : Math.abs(current.difference) < 0.005
                    ? 'Цена совпадает со средней ценой похожих закупок'
                    : `На ${numeric(Math.abs(current.difference))}% ${current.difference > 0 ? 'дороже' : 'дешевле'} средней цены похожих закупок`}
              </div>
              <p className="small muted">
                Период:{' '}
                {current.period.from
                  ? `${dateLabel(current.period.from)} – ${dateLabel(current.period.to)}`
                  : 'все даты из файла'}
                . Выбранная закупка исключена из обеих групп.
              </p>
              {current.selected && (
                <p className="small muted">
                  {[
                    current.selected.vat,
                    current.selected.priceKind,
                    current.selected.characteristics,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              {current.selected?.source.currencyBasis === 'user-confirmed' && (
                <p className="small muted">
                  Валюта {current.selected.currency} подтверждена владельцем выгрузки; в исходном
                  файле столбца валюты нет.
                </p>
              )}
            </div>
            <PriceChart
              key={requestKey}
              data={current}
              comparisonRegion={comparison}
              searchQuery={q}
            />
          </section>
          <section className="panel purchase-catalog">
            <div className="purchase-catalog-heading">
              <div>
                <h2>Каталог закупок</h2>
                <p className="subtitle">
                  Найдено: {numeric(current.total, 0)}. Выберите закупку для сравнения.
                </p>
              </div>
              {current.selected && (
                <button className="btn sm" onClick={() => setSelected('')}>
                  Снять выбор
                </button>
              )}
            </div>
            {current.items.length ? (
              <>
                <div className="purchase-table-scroll">
                  <table className="purchase-table">
                    <thead>
                      <tr>
                        {visibleColumns.map(([key, label]) => (
                          <th key={key} scope="col">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {current.items.map((p) => (
                        <tr
                          key={p.id}
                          className={current.selected?.id === p.id ? 'selected' : ''}
                          onClick={() => choose(p)}
                        >
                          {visibleColumns.map(([key, , render]) => (
                            <td key={key} className={`purchase-cell-${key}`}>
                              {key === 'number' ? (
                                <button
                                  className="purchase-select"
                                  aria-pressed={current.selected?.id === p.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    choose(p);
                                  }}
                                >
                                  № {p.number}
                                </button>
                              ) : (
                                <span>{render(p)}</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="purchase-pagination">
                  <span>
                    Страница {current.page} из{' '}
                    {Math.max(1, Math.ceil(current.total / current.pageSize))}
                  </span>
                  <div className="button-row">
                    <button
                      className="btn sm"
                      disabled={current.page <= 1}
                      onClick={() => setPage(current.page - 1)}
                    >
                      Назад
                    </button>
                    <button
                      className="btn sm"
                      disabled={current.page * current.pageSize >= current.total}
                      onClick={() => setPage(current.page + 1)}
                    >
                      Далее
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="purchase-empty">
                <div className="purchase-empty-icon" aria-hidden="true">
                  ▤
                </div>
                <h2>{meta.total ? 'Закупки не найдены' : 'Добавьте Excel с закупками'}</h2>
                <p>
                  {meta.total
                    ? 'Измените поиск или фильтры. Для записей без даты выберите весь период.'
                    : 'После импорта здесь появятся закупки, цены за единицу и сравнение по выбранному региону.'}
                </p>
                {!meta.total && (
                  <p className="small muted">Цены появятся после загрузки исходных данных.</p>
                )}
              </div>
            )}
          </section>
          {!!meta.total && !meta.dated && (
            <Notice>В Excel нет дат: временной график недоступен. Показан весь период.</Notice>
          )}
          {fields.includes('unitPrice') && (
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
          Плановые и фактические цены разделены. Выбранная закупка исключена. Учитываются все
          записи, прошедшие поиск, фильтры и проверку сопоставимости, включая другие страницы
          каталога.
        </p>
        <p>
          При полном количестве: Σ(цена × количество) / Σ(количество). Если количество указано не
          везде, используется среднее арифметическое всех корректных цен с явной отметкой. Записи
          без даты участвуют только при выборе всего периода. График показывается только при
          заполнении всех интервалов выбранного периода, которых должно быть не меньше двух. При
          пропусках вместо графика показаны причина и разбор выбранной закупки. Данные Excel не
          подтверждают среднерыночную цену.
        </p>
      </details>
    </div>
  );
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
