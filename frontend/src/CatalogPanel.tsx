import { useEffect, useState } from 'react';
import type { Catalog, Tender, TenderListResponse } from '@bnect/shared';
import { api, errorMessage } from './api';
import { Empty, Icon, Loading, TenderCard } from './ui';

export default function CatalogPanel({
  catalog,
  onOpen,
}: {
  catalog: Catalog;
  onOpen: (tender: Tender) => void;
}) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    key: string;
    loading?: boolean;
    data?: TenderListResponse;
    error?: string;
  }>({ key: '' });
  const key = JSON.stringify({ query, region, page, retry });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, loading: true });
    const params = new URLSearchParams({ page: String(page), pageSize: '8' });
    if (query) params.set('q', query);
    if (region) params.set('regionId', region);
    api
      .tenders(params, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ key, error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [key]);
  const current = state.key === key ? state : undefined;
  const data = current?.data;
  const pendingSearch = search.trim() !== query;
  return (
    <section className="panel catalog-panel" aria-labelledby="catalog-title">
      <div className="section-heading">
        <h2 id="catalog-title">
          Все тендеры{data && !pendingSearch && <span className="count">{data.total}</span>}
        </h2>
      </div>
      <form
        className="search-row"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
          setPage(1);
        }}
      >
        <label className="search-box">
          <span className="sr-only">Поиск по названию или номеру тендера</span>
          <Icon name="search" size={15} />
          <input
            className="control"
            type="search"
            placeholder="Название или номер тендера"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button className="btn" type="submit">
          Найти
        </button>
      </form>
      <div style={{ marginBottom: 10 }}>
        <label className="field" style={{ margin: 0, maxWidth: 260 }}>
          <span className="sr-only">Регион каталога</span>
          <select
            className="control"
            aria-label="Регион каталога"
            value={region}
            onChange={(event) => {
              setRegion(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Все регионы</option>
            {catalog.regions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!current || current.loading || pendingSearch ? (
        <Loading text="Обновляем список закупок…" />
      ) : current.error ? (
        <Empty
          title="Каталог недоступен"
          icon="info"
          action={
            <button className="btn sm" onClick={() => setRetry((value) => value + 1)}>
              Повторить
            </button>
          }
        >
          {current.error}
        </Empty>
      ) : data && !data.items.length ? (
        <Empty title="Закупки не найдены">
          Попробуйте другой номер, часть названия или регион каталога.
        </Empty>
      ) : (
        data && (
          <>
            <div className="catalog-list">
              {data.items.map((tender) => (
                <TenderCard key={tender.id} tender={tender} catalog={catalog} onOpen={onOpen} />
              ))}
            </div>
            <div className="pagination">
              <span>
                {(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} из{' '}
                {data.total}
              </span>
              <div className="pagination-buttons">
                <button
                  className="btn sm"
                  aria-label="Предыдущая страница"
                  disabled={page === 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Назад
                </button>
                <button
                  className="btn sm"
                  aria-label="Следующая страница"
                  disabled={page * data.pageSize >= data.total}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Далее
                  <Icon name="chevron" size={12} />
                </button>
              </div>
            </div>
          </>
        )
      )}
    </section>
  );
}
