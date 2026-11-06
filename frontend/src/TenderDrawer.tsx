import { useEffect, useRef, useState } from 'react';
import type { Catalog, RecommendationResponse, Tender, SimilarTenderFilters } from '@bnect/shared';
import { api, errorMessage } from './api';
import TenderComparison from './comparison/TenderComparison';
import {
  availability,
  Empty,
  formatDate,
  formatTime,
  Icon,
  Loading,
  Notice,
  regionName,
} from './ui';

export default function TenderDrawer({
  tender,
  catalog,
  onClose,
  onOpen,
}: {
  tender: Tender;
  catalog: Catalog;
  onClose: () => void;
  onOpen: (tender: Tender) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<{
    key: string;
    loading?: boolean;
    data?: RecommendationResponse;
    error?: string;
  }>({ key: '' });
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState({
    id: '',
    industryGroup: '',
    activity: '',
    procurementType: '',
    procurementMethod: '',
  });
  const selected =
    selection.id === tender.id
      ? selection
      : {
          id: tender.id,
          industryGroup: '',
          activity: '',
          procurementType: '',
          procurementMethod: '',
        };
  const filterKey = JSON.stringify(selected);
  const requestKey = `${tender.id}:${filterKey}:${retry}`;
  const setFilter = (
    name: 'industryGroup' | 'activity' | 'procurementType' | 'procurementMethod',
    value: string,
  ) => setSelection({ ...selected, [name]: value });

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
        ) ?? []),
      ].filter((item) => item.offsetParent !== null);
      if (!elements.length) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === elements[0]) {
        event.preventDefault();
        elements.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === elements.at(-1)) {
        event.preventDefault();
        elements[0].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ key: requestKey, loading: true });
    const filters: SimilarTenderFilters = {
      ...(selected.industryGroup ? { industryGroups: [selected.industryGroup] } : {}),
      ...(selected.activity ? { activities: [selected.activity] } : {}),
      ...(selected.procurementType ? { procurementTypes: [selected.procurementType] } : {}),
      ...(selected.procurementMethod ? { procurementMethods: [selected.procurementMethod] } : {}),
    };
    api
      .similarFiltered(tender.id, filters, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key: requestKey, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ key: requestKey, error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [requestKey]);

  useEffect(() => {
    dialog.current?.scrollTo({ top: 0 });
    closeButton.current?.focus();
  }, [tender.id]);
  const current = state.key === requestKey ? state : undefined;

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="drawer comparison-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tender-detail-title"
        ref={dialog}
      >
        <div className="drawer-header">
          <h2 id="tender-detail-title">Сравнение тендеров</h2>
          <button
            ref={closeButton}
            className="icon-button"
            aria-label="Закрыть сведения о закупке"
            onClick={onClose}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="drawer-body">
          <section className="panel drawer-detail">
            <span className="comparison-eyebrow">Исходный тендер</span>
            <div className="tender-number">
              № {tender.externalNumber}
              <span className="chip orange">
                {tender.source === 'demo' ? 'Демонстрационные данные' : 'Импортированные данные'}
              </span>
            </div>
            <h3>{tender.title}</h3>
            <div className="comparison-source-summary">
              <span>
                <Icon name="pin" size={13} />
                {regionName(tender, catalog)}
              </span>
              <span>
                <Icon name="calendar" size={13} />
                {formatDate(tender.createdAt)}
              </span>
              <span>{tender.activity}</span>
            </div>
            <details className="comparison-source-details">
              <summary>Все сведения об исходном тендере</summary>
              <dl className="details-grid">
                <div>
                  <dt>Регион</dt>
                  <dd>{regionName(tender, catalog)}</dd>
                </div>
                <div>
                  <dt>Дата создания</dt>
                  <dd>{formatDate(tender.createdAt)}</dd>
                </div>
                <div>
                  <dt>Сфера (группа)</dt>
                  <dd>{tender.industryGroup}</dd>
                </div>
                <div>
                  <dt>Сфера деятельности</dt>
                  <dd>{tender.activity}</dd>
                </div>
                <div>
                  <dt>Способ закупки</dt>
                  <dd>{tender.procurementMethod}</dd>
                </div>
                <div>
                  <dt>Вид закупки</dt>
                  <dd>{tender.procurementType}</dd>
                </div>
                <div>
                  <dt>Статус</dt>
                  <dd>
                    {tender.status === 'open'
                      ? 'Открыта'
                      : tender.status === 'closed'
                        ? 'Закрыта'
                        : 'Не указан'}
                  </dd>
                </div>
                <div>
                  <dt>Срок подачи заявок</dt>
                  <dd>
                    {tender.applicationDeadline
                      ? `${formatTime(tender.applicationDeadline)} (UTC+5)`
                      : 'Не указан'}
                  </dd>
                </div>
              </dl>
              {tender.description && (
                <>
                  <h3 style={{ fontSize: 12, marginBottom: 8 }}>Описание</h3>
                  <p className="details-description">{tender.description}</p>
                </>
              )}
              <Notice kind={tender.source === 'demo' ? 'warning' : 'info'}>
                {availability(tender, catalog.demoNow)}.{' '}
                {tender.source === 'demo'
                  ? `Статус и срок демонстрационные, на ${formatTime(catalog.demoNow)} (UTC+5).`
                  : 'Дата создания не является сроком подачи заявок.'}
              </Notice>
            </details>
          </section>
          <section className="panel similar-filters" aria-label="Фильтры похожих закупок">
            <h3>Фильтры похожих закупок</h3>
            <p>Сходство считается по названию. Регион совпадает с исходным тендером.</p>
            <div className="similar-filter-grid">
              {(
                [
                  ['industryGroup', 'Сфера (группа)', catalog.industryGroups],
                  ['activity', 'Сфера деятельности', catalog.activities],
                  ['procurementType', 'Вид закупки или услуги', catalog.procurementTypes],
                  ['procurementMethod', 'Способ закупки', catalog.procurementMethods],
                ] as const
              ).map(([name, label, options]) => (
                <label className="field" key={name}>
                  <span>{label}</span>
                  <select
                    className="control"
                    value={selected[name]}
                    onChange={(event) => setFilter(name, event.target.value)}
                  >
                    <option value="">Любой</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <details className="comparison-source-details">
              <summary>Как работает локальная модель</summary>
              <p>
                {catalog.model.id} работает на CPU в backend из локальной папки
                <code> .cache/models</code>. Страница передаёт ID тендера и фильтры в API; модель
                преобразует название в вектор, а PostgreSQL сравнивает его с сохранёнными векторами
                названий. Оценка показывает сходство, а не вероятность победы.
              </p>
            </details>
          </section>
          {!current || current.loading ? (
            <Loading text="Ищем похожие закупки…" />
          ) : current.error ? (
            <Empty
              title="Не удалось найти похожие закупки"
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
            current.data &&
            (current.data.results.length ? (
              <TenderComparison
                key={tender.id}
                source={tender}
                data={current.data}
                catalog={catalog}
                onOpen={onOpen}
              />
            ) : (
              <Empty title="Похожие закупки не найдены">
                {tender.regionId
                  ? `В регионе «${regionName(tender, catalog)}» нет закупок с выбранными фильтрами. Попробуйте снять часть фильтров.`
                  : 'Укажите корректный регион в Excel и дождитесь обновления каталога.'}
              </Empty>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
