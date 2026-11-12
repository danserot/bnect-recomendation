import { useState, type ReactNode } from 'react';
import type { Catalog, Recommendation, RecommendationResponse, Tender } from '@bnect/shared';
import { formatDate, formatTime, Icon, regionName } from '../ui';
import {
  activityPriority,
  comparedFields,
  dateGap,
  fieldsMatch,
  normalizedField,
  sharedTerms,
} from './model';
import './tender-comparison.css';

function HighlightedText({ text, terms }: { text: string; terms: Set<string> }) {
  return text
    .split(/([\p{L}\p{N}]+)/gu)
    .map((part, index) =>
      terms.has(part.toLocaleLowerCase('ru')) ? <mark key={index}>{part}</mark> : part,
    );
}

function PriorityBadge({ source, candidate }: { source: Tender; candidate: Tender }) {
  const priority = activityPriority(source, candidate);
  return (
    <span className={`comparison-badge ${priority}`}>
      {priority === 'same'
        ? 'Совпадает деятельность'
        : priority === 'fallback'
          ? 'Иная деятельность'
          : 'Деятельность неизвестна'}
    </span>
  );
}

export default function TenderComparison({
  source,
  data,
  catalog,
  onOpen,
}: {
  source: Tender;
  data: RecommendationResponse;
  catalog: Catalog;
  onOpen: (tender: Tender) => void;
}) {
  const [mode, setMode] = useState<'all' | 'pair'>(() =>
    window.matchMedia('(min-width: 1000px)').matches ? 'all' : 'pair',
  );
  const [selectedId, setSelectedId] = useState(data.results[0]!.tender.id);
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [activeField, setActiveField] = useState<string>();
  const selected = data.results.find((item) => item.tender.id === selectedId) ?? data.results[0]!;
  const candidates = mode === 'all' ? data.results : [selected];
  const terms = sharedTerms(source, selected.tender);
  const matched = comparedFields.filter(({ key }) =>
    fieldsMatch(source[key], selected.tender[key]),
  );
  const different = comparedFields.filter(
    ({ key }) =>
      normalizedField(source[key]) &&
      normalizedField(selected.tender[key]) &&
      !fieldsMatch(source[key], selected.tender[key]),
  );
  const fieldValue = (tender: Tender, key: (typeof comparedFields)[number]['key']) =>
    key === 'regionId'
      ? regionName(tender, catalog)
      : normalizedField(tender[key])
        ? tender[key]
        : 'Не указано';

  function row(
    key: string,
    label: string,
    reference: ReactNode,
    render: (item: Recommendation) => ReactNode,
    identical = false,
  ) {
    if (differencesOnly && identical) return null;
    return (
      <tr key={key} className={activeField === key ? 'comparison-row-active' : undefined}>
        <th scope="row">
          <button
            className="comparison-row-label"
            aria-pressed={activeField === key}
            onClick={() => setActiveField(activeField === key ? undefined : key)}
          >
            {label}
          </button>
        </th>
        <td className="comparison-source">{reference}</td>
        {candidates.map((item) => (
          <td
            key={item.tender.id}
            className={
              item.tender.id === selected.tender.id ? 'comparison-selected-cell' : undefined
            }
          >
            {render(item)}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <section className="tender-comparison" aria-labelledby="comparison-heading">
      <div className="comparison-heading">
        <div>
          <span className="comparison-eyebrow">Подбор относительно выбранного тендера</span>
          <h2 id="comparison-heading">
            Сравните похожие закупки <span>{data.results.length}</span>
          </h2>
        </div>
        <span className="comparison-pool">
          Из {data.candidateCount.toLocaleString('ru-RU')} подходящих закупок
        </span>
      </div>

      <div className="comparison-rule" aria-label="Как составлена подборка">
        <span>
          <b>1</b> Все города или выбранный регион
        </span>
        <Icon name="chevron" size={12} />
        <span>
          <b>2</b> Фильтры и срок подачи
        </span>
        <Icon name="chevron" size={12} />
        <span>
          <b>3</b> Сходство полных сведений
        </span>
      </div>
      <p className="comparison-context">
        Возвращаем пять результатов, если под выбранные фильтры подходит хотя бы пять закупок.
        Город, сфера, деятельность и остальные сведения участвуют в смысловом сравнении.
      </p>
      {data.results.length < 5 && (
        <p className="comparison-context">
          Под выбранные фильтры подходит только {data.candidateCount} закупок. Расширьте период или
          снимите часть ограничений, чтобы получить больше результатов.
        </p>
      )}

      <div className="comparison-toolbar">
        <div className="comparison-modes" role="group" aria-label="Вид сравнения">
          <button aria-pressed={mode === 'all'} onClick={() => setMode('all')}>
            {data.results.length === 5 ? 'Все пять' : 'Все результаты'}
          </button>
          <button aria-pressed={mode === 'pair'} onClick={() => setMode('pair')}>
            Попарно
          </button>
        </div>
        <label className="comparison-differences">
          <input
            type="checkbox"
            checked={differencesOnly}
            onChange={(event) => setDifferencesOnly(event.target.checked)}
          />
          Только различия
        </label>
        <span className="comparison-legend">
          <i /> Совпадает с исходным
        </span>
      </div>

      <div className="comparison-picker" role="group" aria-label="Выбрать тендер для разбора">
        {data.results.map((item, index) => (
          <button
            key={item.tender.id}
            title={item.tender.title}
            aria-pressed={selected.tender.id === item.tender.id}
            onClick={() => setSelectedId(item.tender.id)}
          >
            <b>{index + 1}</b>
            <span>№ {item.tender.externalNumber}</span>
          </button>
        ))}
      </div>

      <div
        className={`comparison-table-scroll ${mode}`}
        tabIndex={0}
        role="region"
        aria-label="Таблица сравнения тендеров"
      >
        <table className="comparison-table">
          <caption className="sr-only">
            Исходный тендер и рекомендации. Совпадения отмечены подписью; нажмите название строки,
            чтобы выделить её целиком.
          </caption>
          <colgroup>
            <col className="comparison-label-col" />
            <col className="comparison-source-col" />
            {candidates.map(({ tender }) => (
              <col key={tender.id} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <span className="comparison-table-hint">Одинаковые поля — в одной строке</span>
              </th>
              <th scope="col" className="comparison-source">
                <span className="comparison-column-type">Исходный тендер</span>
                <span className="comparison-number">№ {source.externalNumber}</span>
                <p>{source.title}</p>
              </th>
              {candidates.map((item) => (
                <th
                  key={item.tender.id}
                  scope="col"
                  className={
                    item.tender.id === selected.tender.id ? 'comparison-selected-cell' : undefined
                  }
                >
                  <button
                    className="comparison-column-select"
                    aria-pressed={item.tender.id === selected.tender.id}
                    onClick={() => setSelectedId(item.tender.id)}
                  >
                    <span className="comparison-position">{data.results.indexOf(item) + 1}</span>
                    <span>№ {item.tender.externalNumber}</span>
                  </button>
                  <p>{item.tender.title}</p>
                  <button className="comparison-open" onClick={() => onOpen(item.tender)}>
                    Открыть <Icon name="chevron" size={10} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row(
              'priority',
              'Совпадение деятельности',
              <span className="comparison-reference">Сравниваем с ним</span>,
              (item) => (
                <PriorityBadge source={source} candidate={item.tender} />
              ),
            )}
            {row(
              'date',
              'Дата создания',
              <>
                <strong>{formatDate(source.createdAt)}</strong>
                <small className="comparison-subtext">Отсчёт от этой даты</small>
              </>,
              ({ tender }) => {
                const difference = dateGap(source.createdAt, tender.createdAt);
                return (
                  <>
                    <strong>{formatDate(tender.createdAt)}</strong>
                    <small className="comparison-date-gap">
                      {difference.label}
                      <br />
                      {difference.direction}
                    </small>
                  </>
                );
              },
              candidates.every(
                ({ tender }) => Date.parse(tender.createdAt) === Date.parse(source.createdAt),
              ),
            )}
            {comparedFields
              .filter(
                ({ key }) =>
                  !differencesOnly ||
                  !candidates.every(({ tender }) => fieldsMatch(source[key], tender[key])),
              )
              .map(({ key, label }) =>
                row(key, label, fieldValue(source, key), ({ tender }) => {
                  const match = fieldsMatch(source[key], tender[key]);
                  const known = normalizedField(source[key]) && normalizedField(tender[key]);
                  return (
                    <div
                      className={`comparison-value ${match ? 'match' : known ? 'different' : 'unknown'}`}
                    >
                      <span>{fieldValue(tender, key)}</span>
                      <small>
                        {match ? '✓ Совпадает' : known ? 'Отличается' : 'Нет данных для сравнения'}
                      </small>
                    </div>
                  );
                }),
              )}
            {row(
              'score',
              'Сходство полных сведений',
              <span className="comparison-subtext">Определяет порядок рекомендаций</span>,
              (item) => (
                <div className="comparison-score">
                  <strong>{item.similarity.toFixed(2)}</strong>
                  <small>Смысловое сходство</small>
                </div>
              ),
            )}
            {row(
              'status',
              'Статус',
              source.status === 'open'
                ? 'Открыта'
                : source.status === 'closed'
                  ? 'Закрыта'
                  : 'Не указан',
              ({ tender }) =>
                tender.status === 'open'
                  ? 'Открыта'
                  : tender.status === 'closed'
                    ? 'Закрыта'
                    : 'Не указан',
              candidates.every(({ tender }) => fieldsMatch(source.status, tender.status)),
            )}
            {row(
              'deadline',
              'Подача заявок до',
              source.applicationDeadline ? formatTime(source.applicationDeadline) : 'Не указано',
              ({ tender }) =>
                tender.applicationDeadline ? formatTime(tender.applicationDeadline) : 'Не указано',
              Boolean(source.applicationDeadline) &&
                candidates.every(
                  ({ tender }) =>
                    Boolean(tender.applicationDeadline) &&
                    Date.parse(tender.applicationDeadline!) ===
                      Date.parse(source.applicationDeadline!),
                ),
            )}
          </tbody>
        </table>
      </div>
      <p className="comparison-footnote">
        Нажмите на название строки, чтобы связать её подсветкой во всех колонках. Сходство — не
        вероятность победы. Время — UTC+5.
      </p>

      <div className="comparison-explanation" aria-live="polite">
        <div className="comparison-explanation-heading">
          <div>
            <span className="comparison-eyebrow">
              Разбор результата {data.results.indexOf(selected) + 1}
            </span>
            <h3>Почему выбран этот тендер</h3>
          </div>
          <PriorityBadge source={source} candidate={selected.tender} />
        </div>
        <p className="comparison-reason">
          Тендер прошёл выбранные фильтры, включая срок подачи заявок, если указан период. Оценка
          смыслового сходства полных сведений — {selected.similarity.toFixed(2)}.
        </p>
        <div className="comparison-findings">
          <div>
            <span>Совпадает</span>
            <p>
              {matched.length
                ? matched.map(({ label }) => label).join(' · ')
                : 'Нет заполненных совпадающих полей'}
            </p>
          </div>
          <div>
            <span>Отличается</span>
            <p>
              {different.length
                ? different.map(({ label }) => label).join(' · ')
                : 'Нет различий в заполненных полях'}
            </p>
          </div>
        </div>
        <div className="comparison-text-pair">
          {[source, selected.tender].map((tender, index) => (
            <article key={tender.id}>
              <span className="comparison-column-type">
                {index === 0
                  ? 'Исходный тендер'
                  : `Результат ${data.results.indexOf(selected) + 1}`}{' '}
                · № {tender.externalNumber}
              </span>
              <h4>
                <HighlightedText text={tender.title} terms={terms} />
              </h4>
              <p>
                <HighlightedText text={tender.activity} terms={terms} />
              </p>
              <p className="comparison-description">
                {tender.description ? (
                  <HighlightedText text={tender.description} terms={terms} />
                ) : (
                  'Описание в источнике не указано.'
                )}
              </p>
            </article>
          ))}
        </div>
        <p className="comparison-footnote">
          Жёлтым выделены общие слова в названии, виде работ и описании. Это текстовые совпадения, а
          не вклад отдельных слов в оценку сходства.
        </p>
        <button className="btn" onClick={() => onOpen(selected.tender)}>
          Открыть выбранный тендер <Icon name="chevron" size={12} />
        </button>
      </div>
    </section>
  );
}
