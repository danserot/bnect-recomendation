import type { Catalog, Tender } from '@bnect/shared';
import { useTenderCatalog } from './hooks/useTenderCatalog';
import { Empty, Icon, Loading, TenderCard } from './ui';

export default function CatalogPanel({
  catalog,
  onOpen,
}: {
  catalog: Catalog;
  onOpen: (tender: Tender) => void;
}) {
  const {
    search,
    setSearch,
    region,
    page,
    setPage,
    data,
    error,
    loading,
    pendingSearch,
    changeRegion,
    submitSearch,
    retry,
  } = useTenderCatalog();
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
          submitSearch();
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
            onChange={(event) => changeRegion(event.target.value)}
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
      {loading ? (
        <Loading text="Обновляем список закупок…" />
      ) : error ? (
        <Empty
          title="Каталог недоступен"
          icon="info"
          action={
            <button className="btn sm" onClick={retry}>
              Повторить
            </button>
          }
        >
          {error}
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
