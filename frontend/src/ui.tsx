import { useState, type ReactNode } from 'react';
import type { Catalog, Recommendation, Tender } from '@bnect/shared';

const paths: Record<string, ReactNode> = {
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="3" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a25 25 0 0 0 18 0M10 13v3h4v-3" />
    </>
  ),
  chart: (
    <>
      <path d="M4 3v17h17M8 15v-4M13 15V6M18 15V9" />
    </>
  ),
  network: (
    <>
      <circle cx="5" cy="5" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="11" cy="13" r="2" />
      <circle cx="5" cy="20" r="2" />
      <circle cx="20" cy="19" r="2" />
      <path d="m6.5 6.5 3 5m3-0.5L17.5 7M10 15l-3.5 3.5m6-4.5 6 4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="7.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  chevron: <path d="m8 5 7 7-7 7" />,
  down: <path d="m6 9 6 6 6-6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  file: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
      <path d="M14 3v6h6M8 13h8m-8 4h6" />
    </>
  ),
};
export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.file}
    </svg>
  );
}
export function Notice({
  children,
  kind = '',
  icon = 'info',
}: {
  children: ReactNode;
  kind?: string;
  icon?: string;
}) {
  return (
    <div className={`notice ${kind}`}>
      <Icon name={icon} size={15} />
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title,
  children,
  icon = 'search',
  action,
}: {
  title: string;
  children: ReactNode;
  icon?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={21} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Loading({ text = 'Загружаем данные…' }: { text?: string }) {
  return (
    <div className="loading-line" role="status">
      <span className="loading-dot" />
      {text}
    </div>
  );
}
export const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Asia/Qyzylorda',
      }).format(date);
};
export const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Qyzylorda',
      }).format(date);
};
export function regionName(tender: Tender, catalog: Catalog) {
  return (
    catalog.regions.find((region) => region.id === tender.regionId)?.name ?? 'Регион не указан'
  );
}
export function availability(tender: Tender, demoNow: string) {
  if (!tender.status || !tender.applicationDeadline) return 'Доступность участия неизвестна';
  return tender.status === 'open' && new Date(tender.applicationDeadline) > new Date(demoNow)
    ? 'Открыта на демо-дату'
    : 'Приём заявок завершён';
}
export function TenderCard({
  tender,
  catalog,
  onOpen,
  recommendation,
  rank,
}: {
  tender: Tender;
  catalog: Catalog;
  onOpen: (tender: Tender) => void;
  recommendation?: Recommendation;
  rank?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = availability(tender, catalog.demoNow);
  return (
    <article className={`tender-card ${recommendation ? 'recommended' : ''}`}>
      <div className="tender-card-top">
        <div>
          <div className="tender-number">
            {rank && <span className="rank">{rank}</span>}№ {tender.externalNumber}
            <span>{tender.source === 'demo' ? 'Демо' : 'Импорт'}</span>
          </div>
          <button className="tender-title" onClick={() => onOpen(tender)}>
            {tender.title}
          </button>
        </div>
        {recommendation && (
          <div
            className="similarity"
            aria-label={`Косинусное сходство: ${recommendation.similarity.toFixed(2)}`}
          >
            <strong>{recommendation.similarity.toFixed(2)}</strong>
            <span>косинусное сходство</span>
          </div>
        )}
      </div>
      <div className="tender-meta">
        <span className="meta-item">
          <Icon name="pin" size={12} />
          {regionName(tender, catalog)}
        </span>
        <span className="meta-item">
          <Icon name="calendar" size={12} />
          Создан {formatDate(tender.createdAt)}
        </span>
        <span>{tender.procurementType}</span>
      </div>
      <div className="card-footer">
        <div className="chips">
          <span className="chip">{tender.industryGroup}</span>
          <span className={`chip ${status.includes('Открыта') ? 'green' : 'gray'}`}>{status}</span>
        </div>
        {recommendation ? (
          <button
            className="explanation-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Скрыть объяснение' : 'Почему в подборке'}
            <Icon name="down" size={12} />
          </button>
        ) : (
          <button className="explanation-toggle" onClick={() => onOpen(tender)}>
            Подробнее
            <Icon name="chevron" size={12} />
          </button>
        )}
      </div>
      {expanded && recommendation && (
        <div className="explanation">
          <p>
            <strong>Ранжирование:</strong> {recommendation.explanation.rankingReason} Косинусное
            сходство: {recommendation.similarity.toFixed(2)}. Это не вероятность победы или допуска.
          </p>
          <p>
            <strong>Источник запроса:</strong>{' '}
            {recommendation.explanation.querySource === 'profile'
              ? 'вектор специализации поставщика'
              : 'query-вектор выбранного тендера'}
            .
          </p>
          <p>
            <strong>Наблюдаемые совпадения:</strong>{' '}
            {recommendation.explanation.matchedFields.length
              ? recommendation.explanation.matchedFields.join('; ')
              : 'точные совпадения полей отсутствуют'}
            . Поля поясняют результат, но не раскладывают вклад embedding-модели.
          </p>
          <p>
            <strong>Ограничения:</strong> {recommendation.explanation.regionalFilter}.{' '}
            {recommendation.explanation.availability}.
          </p>
          <p>
            <strong>Предмет закупки:</strong> {recommendation.explanation.specialization}
          </p>
        </div>
      )}
    </article>
  );
}
