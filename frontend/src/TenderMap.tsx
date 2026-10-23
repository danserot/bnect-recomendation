import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Catalog, Tender, VectorSpaceResponse, VectorPoint } from '@bnect/shared';
import { Loading, Notice, Empty, regionName } from './ui';
import MapCanvas from './MapCanvas';
import { fitView, zoomAt, type MapFrame, type MapView } from './mapGeometry';

const palette = [
  '#e47924',
  '#497fb6',
  '#9671bb',
  '#419a78',
  '#bc8d24',
  '#b25e7c',
  '#388c9c',
  '#7d884b',
  '#9c6c50',
  '#ad7caa',
  '#686fbd',
  '#99864d',
];
export default function TenderMap({
  catalog,
  tenderId,
  onOpen,
}: {
  catalog: Catalog;
  tenderId?: string;
  onOpen: (tender: Tender) => void;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<VectorSpaceResponse | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string[]>([]),
    [hover, setHover] = useState<VectorPoint | null>(null),
    [found, setFound] = useState<string>(),
    [search, setSearch] = useState('');
  const [frame, setFrame] = useState<MapFrame>({ width: 900, height: 530 }),
    [view, setView] = useState<MapView>({ x: 0, y: 0, span: 1 });
  const receiveFrame = useCallback((next: MapFrame) => setFrame(next), []);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    setHover(null);
    setFound(undefined);
    setSearch('');
    fetch('/api/vector-space' + (tenderId ? '?tenderId=' + encodeURIComponent(tenderId) : ''), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        return result as VectorSpaceResponse;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        const anchor =
          result.points.find(
            (point) => point.tender.id === result.recommendations.query.tenderId,
          ) ?? result.points[0];
        const category = anchor?.tender.industryGroup;
        const initial = category ? [category] : [];
        setSelected(initial);
        setData(result);
        setView(
          fitView(
            result.points.filter((point) => initial.includes(point.tender.industryGroup)),
            { width: 900, height: 530 },
          ),
        );
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError(problem.message);
      });
    return () => controller.abort();
  }, [tenderId, retry]);
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const point of data?.points ?? [])
      counts.set(point.tender.industryGroup, (counts.get(point.tender.industryGroup) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b, 'ru'));
  }, [data]);
  const colors = useMemo(
    () => new Map(groups.map(([name], i) => [name, palette[i % palette.length]])),
    [groups],
  );
  const visible = useMemo(() => {
    const included = new Set(selected);
    return data?.points.filter((point) => included.has(point.tender.industryGroup)) ?? [];
  }, [data, selected]);
  const results = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru');
    return query
      ? (data?.points.filter((point) =>
          `${point.tender.externalNumber} ${point.tender.title}`
            .toLocaleLowerCase('ru')
            .includes(query),
        ) ?? [])
      : [];
  }, [data, search]);
  const base = useMemo(() => fitView(data?.points ?? [], frame), [data, frame]);
  function chooseCategories(next: string[]) {
    setSelected(next);
    setHover(null);
    setView(
      fitView(
        data?.points.filter((point) => next.includes(point.tender.industryGroup)) ?? [],
        frame,
      ),
    );
  }
  function locate(point: VectorPoint) {
    if (!selected.includes(point.tender.industryGroup))
      setSelected((previous) => [...previous, point.tender.industryGroup]);
    setFound(point.tender.id);
    setHover(point);
    setView({ x: point.x, y: point.y, span: base.span / 10 });
    requestAnimationFrame(() => {
      mapContainer.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      mapContainer.current?.querySelector('canvas')?.focus({ preventScroll: true });
    });
  }
  function zoom(factor: number) {
    setView((previous) =>
      zoomAt(previous, frame, frame.width / 2, frame.height / 2, factor, base.span),
    );
  }
  if (error)
    return (
      <Empty
        title="Карта недоступна"
        action={
          <button className="btn" onClick={() => setRetry((v) => v + 1)}>
            Повторить
          </button>
        }
      >
        {error}
      </Empty>
    );
  if (!data) return <Loading text="Строим карту реальных векторов…" />;
  const active = hover ?? data.points.find((point) => point.tender.id === found);
  return (
    <section className="panel vector-panel">
      <div className="vector-toolbar">
        <div>
          <h1>Векторное пространство</h1>
          <p>Перетаскивайте карту. Колесо мыши или жест двумя пальцами меняют масштаб.</p>
        </div>
        <div className="map-navigation">
          <button className="btn sm" aria-label="Уменьшить карту" onClick={() => zoom(1.4)}>
            −
          </button>
          <span>{(base.span / view.span).toFixed(1)}×</span>
          <button className="btn sm" aria-label="Увеличить карту" onClick={() => zoom(1 / 1.4)}>
            +
          </button>
          <button className="btn sm" onClick={() => setView(fitView(visible, frame))}>
            Показать выбранные
          </button>
        </div>
      </div>
      <div className="map-tools">
        <label className="field">
          <span>Найти точку по номеру или названию — во всём каталоге</span>
          <input
            type="search"
            className="control"
            placeholder="Например, K2-014618 или электроснабжение"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={200}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results[0]) {
                event.preventDefault();
                locate(results[0]);
              }
            }}
          />
        </label>
        <details className="map-categories">
          <summary>
            Категории: {selected.length} из {groups.length}
          </summary>
          <div className="button-row">
            <button
              className="btn sm"
              onClick={() => chooseCategories(groups.map(([name]) => name))}
            >
              Все категории
            </button>
            <button className="btn sm" onClick={() => chooseCategories([])}>
              Снять все
            </button>
          </div>
          <div className="map-category-list">
            {groups.map(([name, count]) => (
              <label className="check-label" key={name}>
                <input
                  type="checkbox"
                  checked={selected.includes(name)}
                  onChange={() =>
                    chooseCategories(
                      selected.includes(name)
                        ? selected.filter((value) => value !== name)
                        : [...selected, name],
                    )
                  }
                />
                <i className="legend-dot" style={{ background: colors.get(name) }} />
                <span>{name}</span>
                <span className="map-category-count">{count.toLocaleString('ru')}</span>
              </label>
            ))}
          </div>
        </details>
      </div>
      {search.trim() && (
        <div className="map-search-results" aria-live="polite">
          <p>
            Найдено: {results.length.toLocaleString('ru')}
            {results.length > 12 ? ' · показаны первые 12' : ''}. Нажмите результат, чтобы найти его
            на карте.
          </p>
          {results.slice(0, 12).map((point) => (
            <button
              className="map-search-result"
              key={point.tender.id}
              onClick={() => locate(point)}
            >
              <span>
                № {point.tender.externalNumber} · {point.tender.title}
              </span>
              <small>
                {point.tender.industryGroup} · {regionName(point.tender, catalog)}
              </small>
            </button>
          ))}
          {!results.length && <p>Совпадений нет. Попробуйте часть названия или другой номер.</p>}
        </div>
      )}
      <p className="map-visible-count" role="status">
        Показано <strong>{visible.length.toLocaleString('ru')}</strong> из{' '}
        {data.points.length.toLocaleString('ru')} тендеров ·{' '}
        {selected.length === groups.length
          ? 'все категории'
          : selected.length
            ? 'только выбранные категории'
            : 'выберите хотя бы одну категорию'}
      </p>
      <div ref={mapContainer}>
        <MapCanvas
          points={visible}
          view={view}
          onView={setView}
          baseSpan={base.span}
          colors={colors}
          anchor={data.recommendations.query.tenderId}
          found={found}
          query={data.query}
          onHover={setHover}
          onOpen={(point) => onOpen(point.tender)}
          onFrame={receiveFrame}
          variance={data.explainedVariance}
        />
      </div>
      {!visible.length && (
        <p className="small">Категории отключены. Отметьте нужные категории над картой.</p>
      )}
      <div className="scatter-tooltip map-point-info">
        {active ? (
          <>
            <div>
              <strong>
                № {active.tender.externalNumber} · {active.tender.title}
              </strong>
              <p>
                {active.tender.industryGroup} · {regionName(active.tender, catalog)}
              </p>
              <p>
                X = {active.x.toFixed(4)} · Y = {active.y.toFixed(4)}
                {!selected.includes(active.tender.industryGroup) ? ' · категория скрыта' : ''}
              </p>
            </div>
            <button className="btn sm" onClick={() => onOpen(active.tender)}>
              Открыть тендер
            </button>
          </>
        ) : (
          'Наведите курсор на маленькую точку или найдите тендер через поиск. Нажатие на точку открывает сведения и пять похожих.'
        )}
      </div>
      <div className="legend">
        {groups
          .filter(([name]) => selected.includes(name))
          .map(([name]) => (
            <span className="legend-item" key={name}>
              <i className="legend-dot" style={{ background: colors.get(name) }} />
              {name}
            </span>
          ))}
      </div>
      <p className="small">
        Обычные точки — 1,7 px; оранжевая окружность — выбранный тендер; тёмная обводка — top-5;
        синяя окружность — результат поиска. Категории управляют видимостью карты, а не составом
        рекомендаций. PCA остаётся общей для каталога.
      </p>
      <Notice>
        Числа на осях — координаты PCA. Двумерная проекция может искажать расстояния; рекомендации
        считаются по полным векторам. Управление с клавиатуры: стрелки — перемещение, + / − —
        масштаб; «Показать выбранные» возвращает точки в кадр.
      </Notice>
    </section>
  );
}
