import { useEffect, useRef, useState } from 'react';
import type { Catalog, RecommendationResponse, Tender } from '@bnect/shared';
import { api, errorMessage } from './api';
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
    id: string;
    loading?: boolean;
    data?: RecommendationResponse;
    error?: string;
  }>({ id: '' });
  const [retry, setRetry] = useState(0);

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
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
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
    setState({ id: tender.id, loading: true });
    api
      .similar(tender.id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ id: tender.id, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ id: tender.id, error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [tender.id, retry]);

  useEffect(() => {
    dialog.current?.scrollTo({ top: 0 });
    closeButton.current?.focus();
  }, [tender.id]);
  const current = state.id === tender.id ? state : undefined;

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tender-detail-title"
        ref={dialog}
      >
        <div className="drawer-header">
          <h2 id="tender-detail-title">Сведения о закупке</h2>
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
            <div className="tender-number">
              № {tender.externalNumber}
              <span className="chip orange">
                {tender.source === 'demo' ? 'Демонстрационные данные' : 'Импортированные данные'}
              </span>
            </div>
            <h3>{tender.title}</h3>
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
          </section>
      <div className="section-heading">
            <h2>
              Похожие закупки
              {current?.data && <span className="count">{current.data.results.length}</span>}
            </h2>
          </div>
      <p className="small muted">Подбор по виду работ из источника и смыслу предмета. Повторные предметы и объекты пропускаются; если разных подходящих закупок меньше пяти, показываем фактическое число.</p>
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
              <div className="recommendations">
                {current.data.results.map((item) => (
                  <article className="tender-card" key={item.tender.id}>
                    <div className="tender-card-top">
                      <div>
                        <div className="tender-number">№ {item.tender.externalNumber}</div>
                        <button className="tender-title" onClick={() => onOpen(item.tender)}>
                          {item.tender.title}
                        </button>
                      </div>
                      <span
                        className="simple-score"
                        title="Косинусное сходство, не вероятность победы"
                      >
                        {item.similarity.toFixed(2)}
                        <span>сходство</span>
                      </span>
                    </div>
                    <div className="tender-meta">
                      <span className="meta-item">
                        <Icon name="pin" size={12} />
                        {regionName(item.tender, catalog)}
                      </span>
                      <span>{item.tender.industryGroup}</span>
                      <span>{item.tender.procurementType}</span>
                    </div>
                    <p className="small" style={{ margin: '10px 0 0', color: '#4f657b' }}>
                      <strong>Работы / поставки:</strong> {item.tender.activity}
                    </p>
                    <div className="card-footer">
                      <span className="chip gray">
                        {availability(item.tender, catalog.demoNow)}
                      </span>
                      <button className="explanation-toggle" onClick={() => onOpen(item.tender)}>
                        Подробнее
                        <Icon name="chevron" size={12} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="Похожие закупки не найдены">
                В базе пока недостаточно тендеров для этой подборки.
              </Empty>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
