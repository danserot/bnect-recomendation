import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Catalog,
  RecommendationRequest,
  Tender,
  VectorPoint,
  VectorSpaceResponse,
} from '@bnect/shared';
import { api, errorMessage } from './api';
import { Empty, Icon, Loading, Notice, regionName, TenderCard } from './ui';

const colors = [
  '#df8a4b',
  '#668ab7',
  '#77a68c',
  '#a38cbc',
  '#c5a460',
  '#699f9f',
  '#ba7f8e',
  '#a09b74',
  '#8995b7',
  '#9ca37f',
  '#ac927b',
  '#8caba7',
];
export default function VectorSpace({
  catalog,
  request,
  requestKey,
  invalidReason,
  onOpen,
  selectedTenderId,
}: {
  catalog: Catalog;
  request: RecommendationRequest;
  requestKey: string;
  invalidReason: string;
  onOpen: (tender: Tender) => void;
  selectedTenderId?: string;
}) {
  const [state, setState] = useState<{
    key: string;
    loading?: boolean;
    data?: VectorSpaceResponse;
    error?: string;
  }>({ key: '' });
  const [retry, setRetry] = useState(0);
  const [hovered, setHovered] = useState<VectorPoint | null>(null);
  const activeKey = useRef(requestKey);
  activeKey.current = requestKey;
  useEffect(() => {
    const controller = new AbortController();
    setHovered(null);
    if (invalidReason) return () => controller.abort();
    setState({ key: requestKey, loading: true });
    api
      .vectorSpace(request, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && activeKey.current === requestKey)
          setState({ key: requestKey, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ key: requestKey, error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [requestKey, retry, invalidReason]);
  const current = state.key === requestKey ? state : undefined;
  const data = current?.data;
  const groups = useMemo(
    () =>
      data
        ? [...new Set(data.points.map((point) => point.tender.industryGroup))].sort((a, b) =>
            a.localeCompare(b, 'ru'),
          )
        : [],
    [data],
  );
  const color = (group: string) => colors[groups.indexOf(group) % colors.length];
  const project = useMemo(() => {
    if (!data) return (_x: number, _y: number) => [0, 0];
    const xs = [...data.points.map((point) => point.x), data.query.x];
    const ys = [...data.points.map((point) => point.y), data.query.y];
    const xmin = Math.min(...xs),
      xmax = Math.max(...xs),
      ymin = Math.min(...ys),
      ymax = Math.max(...ys);
    return (x: number, y: number) => [
      50 + ((x - xmin) / (xmax - xmin || 1)) * 660,
      370 - ((y - ymin) / (ymax - ymin || 1)) * 330,
    ];
  }, [data]);
  const queryPoint = data ? project(data.query.x, data.query.y) : [0, 0];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Смысловая карта</span>
          <h1>Векторное пространство</h1>
          <p className="subtitle">Реальные embedding-векторы тендеров в двумерной проекции PCA.</p>
        </div>
        <div className="heading-mark">
          <Icon name="chart" size={19} />
          <span>
            <strong>{catalog.model.dimensions}D</strong> → 2D проекция
          </span>
        </div>
      </div>
      <div className="vector-layout">
        <section className="panel vector-panel">
          <div className="vector-toolbar">
            <div>
              <h2>Карта закупок</h2>
              <p>
                Запрос: профиль «{request.profile.name}» · те же ограничения, что во вкладке
                «Закупки»
              </p>
            </div>
            <button
              className="btn sm"
              onClick={() => setRetry((value) => value + 1)}
              disabled={current?.loading || !!invalidReason}
            >
              <Icon name="chart" size={14} />
              Обновить
            </button>
          </div>
          {invalidReason ? (
            <Empty title="Уточните условия поиска" icon="filters">
              {invalidReason}
            </Empty>
          ) : !current || current.loading ? (
            <Loading text="Строим PCA-проекцию реальных векторов…" />
          ) : current.error ? (
            <Empty
              title="Не удалось построить карту"
              icon="info"
              action={
                <button className="btn sm" onClick={() => setRetry((value) => value + 1)}>
                  Повторить
                </button>
              }
            >
              {current.error}
            </Empty>
          ) : (
            data && (
              <>
                <div className="scatter-wrap">
                  <svg
                    className="scatter"
                    viewBox="0 0 760 415"
                    role="group"
                    aria-label="PCA-карта тендеров. Каждая точка доступна с клавиатуры. Enter открывает сведения."
                  >
                    <title>Двумерная PCA-проекция реальных векторов</title>
                    {[70, 145, 220, 295, 370].map((y) => (
                      <line className="plot-grid" key={`y${y}`} x1="34" x2="728" y1={y} y2={y} />
                    ))}
                    {[55, 165, 275, 385, 495, 605, 715].map((x) => (
                      <line className="plot-grid" key={`x${x}`} x1={x} x2={x} y1="28" y2="382" />
                    ))}
                    <text x="680" y="405" className="plot-axis">
                      Компонента 1
                    </text>
                    <text x="12" y="24" className="plot-axis">
                      Компонента 2
                    </text>
                    {[...data.points]
                      .sort((a, b) => Number(a.recommended) - Number(b.recommended))
                      .map((point) => {
                        const [x, y] = project(point.x, point.y);
                        const selected = selectedTenderId === point.tender.id;
                        return (
                          <g key={point.tender.id}>
                            {selected && (
                              <circle
                                cx={x}
                                cy={y}
                                r={13}
                                fill="none"
                                stroke="#f47721"
                                strokeWidth="2"
                              />
                            )}
                            <circle
                              className="point"
                              role="button"
                              tabIndex={0}
                              aria-label={`${point.tender.externalNumber}, ${point.tender.title}, ${point.tender.industryGroup}, ${regionName(point.tender, catalog)}${point.recommended ? ', top-5' : ''}${!point.eligible ? ', отфильтрована' : ''}`}
                              cx={x}
                              cy={y}
                              r={point.recommended ? 6 : 4.5}
                              fill={color(point.tender.industryGroup)}
                              opacity={point.eligible ? 0.85 : 0.18}
                              stroke={point.recommended ? '#343c47' : '#fff'}
                              strokeWidth={point.recommended ? 1.8 : 1}
                              onMouseEnter={() => setHovered(point)}
                              onFocus={() => setHovered(point)}
                              onClick={() => onOpen(point.tender)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  onOpen(point.tender);
                                }
                              }}
                            >
                              <title>{point.tender.title}</title>
                            </circle>
                          </g>
                        );
                      })}
                    <polygon
                      points={`${queryPoint[0]},${queryPoint[1] - 10} ${queryPoint[0] + 8},${queryPoint[1]} ${queryPoint[0]},${queryPoint[1] + 10} ${queryPoint[0] - 8},${queryPoint[1]}`}
                      fill="#f47721"
                      stroke="white"
                      strokeWidth="2"
                      role="img"
                      aria-label="Запросный вектор профиля поставщика"
                    >
                      <title>Запрос профиля: {request.profile.name}</title>
                    </polygon>
                  </svg>
                </div>
                <div className="scatter-tooltip" role="status">
                  <Icon name={hovered ? 'file' : 'info'} size={17} />
                  <div>
                    {hovered ? (
                      <>
                        <span className="small muted">№ {hovered.tender.externalNumber}</span>
                        <strong>{hovered.tender.title}</strong>
                        <p>
                          {hovered.tender.industryGroup} · {regionName(hovered.tender, catalog)} ·{' '}
                          {hovered.eligible ? 'Проходит фильтры' : 'Исключён ограничениями'}
                        </p>
                      </>
                    ) : (
                      <>
                        <strong>Изучайте закупки на карте</strong>
                        <p>
                          Наведите курсор или перейдите к точке клавишей Tab. Нажмите, чтобы открыть
                          сведения и похожие закупки.
                        </p>
                      </>
                    )}
                  </div>
                </div>
                <div className="legend" aria-label="Легенда отраслей">
                  {groups.map((group) => (
                    <span key={group} className="legend-item">
                      <i className="legend-dot" style={{ background: color(group) }} />
                      {group}
                    </span>
                  ))}
                </div>
                <div className="vector-key">
                  <span>
                    <i className="key-query" />
                    Вектор профиля
                  </span>
                  <span>
                    <i className="key-top" />
                    Top-5 рекомендаций
                  </span>
                  <span>
                    <i className="key-ineligible" />
                    Исключены фильтрами
                  </span>
                </div>
              </>
            )
          )}
          <Notice kind="info">
            Это двумерная проекция. Расстояния на графике могут искажаться. Рекомендации рассчитаны
            по исходным векторам.
          </Notice>
        </section>
        <aside className="vector-side">
          <section className="panel panel-pad">
            <h2 style={{ fontSize: 14 }}>О проекции</h2>
            <p className="profile-description">
              PCA обучается на векторах тендеров. Вектор профиля проецируется тем же
              преобразованием.
            </p>
            <div className="metric-grid">
              <div className="metric">
                <strong>{data?.points.length ?? '—'}</strong>
                <span>тендеров на карте</span>
              </div>
              <div className="metric">
                <strong>
                  {data
                    ? `${((data.explainedVariance[0] + data.explainedVariance[1]) * 100).toFixed(1)}%`
                    : '—'}
                </strong>
                <span>объяснённой дисперсии</span>
              </div>
            </div>
            {data && (
              <p className="small muted" style={{ fontSize: 10 }}>
                Компонента 1: {(data.explainedVariance[0] * 100).toFixed(1)}% · Компонента 2:{' '}
                {(data.explainedVariance[1] * 100).toFixed(1)}%<br />
                Прошли фильтры: {data.recommendations.candidateCount}. В подборке:{' '}
                {data.recommendations.results.length}.
              </p>
            )}
            <hr className="divider" />
            <p className="small muted" style={{ marginBottom: 0, fontSize: 10 }}>
              Проекция кешируется по набору embeddings и не переобучается при выборе другого
              профиля. Top-5 вычисляется точным поиском в {catalog.model.dimensions} измерениях.
            </p>
          </section>
          <Notice>
            Приглушённые точки остаются на карте для контекста и не участвуют в top-5. Географию и
            остальные ограничения можно изменить во вкладке «Закупки».
          </Notice>
          {data && data.recommendations.results.length > 0 && (
            <section className="panel panel-pad">
              <h2 style={{ fontSize: 14, marginBottom: 14 }}>Ближайший тендер</h2>
              <TenderCard
                tender={data.recommendations.results[0].tender}
                catalog={catalog}
                recommendation={data.recommendations.results[0]}
                rank={1}
                onOpen={onOpen}
              />
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
