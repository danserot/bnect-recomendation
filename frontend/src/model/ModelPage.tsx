import { useEffect, useState } from 'react';
import type {
  BenchmarkCategory,
  ModelBenchmarkReport,
  ModelBenchmarkStatus,
  ModelOverview,
} from '@bnect/shared';
import { api, errorMessage } from '../api';
import { Loading, Notice, formatTime } from '../ui';
import './model.css';

const categories: Record<BenchmarkCategory, string> = {
  synonym: 'Синонимы',
  paraphrase: 'Перефразирования',
  abbreviation: 'Сокращения',
};
const phases = {
  idle: 'Ожидание',
  loading: 'Загрузка локальной модели',
  warmup: 'Прогрев ONNX',
  documents: 'Векторизация тестового корпуса',
  queries: 'Проверка запросов без кэша',
  saving: 'Сохранение отчёта',
};
const number = (value: number, digits = 1) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
const percent = (value: number) => `${number(value * 100)}%`;
const bytes = (value: number) => `${number(value / 1024 ** 2)} МиБ`;

function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function Results({ report }: { report: ModelBenchmarkReport }) {
  const [filter, setFilter] = useState<'all' | 'errors' | BenchmarkCategory>('all');
  const cases = report.cases.filter(
    (item) =>
      filter === 'all' || (filter === 'errors' ? item.rank !== 1 : item.category === filter),
  );
  return (
    <>
      <div className="model-quality-grid">
        {Object.entries(categories).map(([key, label]) => {
          const metric = report.byCategory[key as BenchmarkCategory];
          return (
            <div className="model-quality" key={key}>
              <div>
                <strong>{label}</strong>
                <span>{percent(metric.top1)}</span>
              </div>
              <div className="model-bar">
                <span style={{ width: `${metric.top1 * 100}%` }} />
              </div>
              <p>
                {Math.round(metric.top1 * metric.count)} из {metric.count} на первом месте
              </p>
            </div>
          );
        })}
      </div>
      <div className="model-results-heading">
        <div>
          <h3>Результат каждого запроса</h3>
          <p>Ожидаемый ответ сравнивается со всем корпусом. Неудачные примеры тоже включены.</p>
        </div>
        <label>
          Показать
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as typeof filter)}
          >
            <option value="all">Все примеры ({report.queryCount})</option>
            <option value="errors">Ошибки Top-1</option>
            {Object.entries(categories).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="model-cases">
        {cases.map((item) => (
          <details key={item.id} className={`model-case ${item.rank === 1 ? 'passed' : 'missed'}`}>
            <summary>
              <span className="model-case-status">{item.rank === 1 ? '✓' : `#${item.rank}`}</span>
              <span className="model-case-title">
                <strong>{item.query}</strong>
                <span>
                  {item.label} · {categories[item.category]}
                </span>
              </span>
              <span className="model-case-time">{number(item.queryMs)} мс</span>
              <span className="model-case-expand" aria-hidden="true">
                +
              </span>
            </summary>
            <div className="model-case-body">
              <p>
                <strong>Ожидаемый ответ:</strong> {item.expectedText}
              </p>
              <p>
                Место: <strong>{item.rank}</strong> · Косинусное сходство:{' '}
                <strong>{number(item.similarity, 4)}</strong> · Ранжирование:{' '}
                {number(item.rankingMs, 3)} мс
              </p>
              <ol>
                {item.top.map((candidate) => (
                  <li key={candidate.id}>
                    <span>
                      {candidate.text}
                      {candidate.id === item.expectedId && <em>Ожидаемый ответ</em>}
                    </span>
                    <strong>{number(candidate.similarity, 4)}</strong>
                  </li>
                ))}
              </ol>
            </div>
          </details>
        ))}
        {!cases.length && <p className="model-empty">В этой группе нет примеров.</p>}
      </div>
    </>
  );
}

export default function ModelPage() {
  const [overview, setOverview] = useState<ModelOverview>();
  const [status, setStatus] = useState<ModelBenchmarkStatus>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const running = status?.state === 'running';

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    Promise.all([api.model(controller.signal), api.modelBenchmark(controller.signal)])
      .then(([data, job]) => {
        if (!controller.signal.aborted) {
          setOverview(data);
          setStatus(job);
        }
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError(errorMessage(problem));
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.modelBenchmark(controller.signal);
        if (controller.signal.aborted) return;
        setStatus(next);
        setError('');
        if (next.state !== 'running') return;
      } catch (problem) {
        if (!controller.signal.aborted) setError(errorMessage(problem));
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [running]);

  useEffect(() => {
    if (!running || !status?.startedAt) return;
    const update = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(status.startedAt!)) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [running, status?.startedAt]);

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      setStatus(await api.startModelBenchmark());
    } catch (problem) {
      setError(errorMessage(problem));
      // Another tab may already have started the job. Attach to its real status.
      try {
        setStatus(await api.modelBenchmark());
      } catch {
        /* Keep the original error. */
      }
    } finally {
      setStarting(false);
    }
  };

  const report = status?.report;
  const model = overview?.model;
  if (!overview)
    return (
      <div className="model-page">
        <h1>Модель и тесты</h1>
        {error ? (
          <>
            <Notice kind="error">{error}</Notice>
            <button className="btn" onClick={() => setAttempt((value) => value + 1)}>
              Повторить
            </button>
          </>
        ) : (
          <Loading text="Проверяем локальную модель…" />
        )}
      </div>
    );

  return (
    <div className="model-page">
      <div className="model-hero">
        <div>
          <span className="eyebrow">Смысловой поиск Bnect</span>
          <h1>Модель и тесты</h1>
          <p>
            Где работает модель, как она понимает формулировки и сколько времени занимает поиск.
          </p>
        </div>
        <span className="model-local">
          <span /> Локально · CPU · Q8
        </span>
      </div>
      <section className="model-panel model-about" aria-labelledby="model-about-title">
        <div className="model-about-heading">
          <div>
            <h2 id="model-about-title">{model!.id}</h2>
            <p>Embedding-модель для сравнения смысла текстов</p>
          </div>
          <span className="model-revision">Ревизия {model!.revision}</span>
        </div>
        <p>
          Модель превращает запрос и полные сведения о закупке в векторы из {model!.dimensions}{' '}
          чисел. Близкие по смыслу тексты сравниваются по косинусному сходству: например, «кровля» и
          «крыша» могут находиться рядом без буквального совпадения слов.
        </p>
        <div className="model-flow" aria-label="Схема обработки запроса">
          <div>
            <span>01</span>
            <strong>Запрос пользователя</strong>
            <small>Текст из интерфейса</small>
          </div>
          <b aria-hidden="true">→</b>
          <div>
            <span>02</span>
            <strong>E5 в backend</strong>
            <small>Вычисление вектора на CPU</small>
          </div>
          <b aria-hidden="true">→</b>
          <div>
            <span>03</span>
            <strong>PostgreSQL + pgvector</strong>
            <small>Сравнение с векторами закупок</small>
          </div>
        </div>
        <div className="model-location-grid">
          <div>
            <h3>Где работает</h3>
            <p>
              В процессе Node.js сервиса backend
              {model!.runtime === 'docker'
                ? ', внутри локального Docker-контейнера'
                : ' на этом компьютере'}
              . Исполнение: Transformers.js + ONNX Runtime, CPU, квантование Q8.
            </p>
            <p>
              В браузере работают интерфейс и отображение результатов. Обращений к внешнему API
              модели нет.
            </p>
          </div>
          <div>
            <h3>Где хранится</h3>
            <code>{model!.modelDirectory}</code>
            {model!.runtime === 'docker' && (
              <p>
                Папка контейнера подключена из <code>.cache/models</code> в корне проекта на
                компьютере.
              </p>
            )}
            <p>
              Файлы модели: <strong>{bytes(model!.totalBytes)}</strong>. Веса загружаются в память
              при первом обращении. Сетевая загрузка отключена.
            </p>
          </div>
        </div>
        <details className="model-technical">
          <summary>Файлы модели и среда исполнения</summary>
          <dl>
            <div>
              <dt>CPU</dt>
              <dd>{model!.environment.cpu}</dd>
            </div>
            <div>
              <dt>Среда</dt>
              <dd>
                {model!.environment.platform} / {model!.environment.architecture} ·{' '}
                {model!.environment.logicalCores} логических ядер · Node.js{' '}
                {model!.environment.node}
              </dd>
            </div>
            <div>
              <dt>Пакет документов</dt>
              <dd>{model!.batchSize} · max_length 512 · mean pooling · L2-нормализация</dd>
            </div>
            <div>
              <dt>Версия embeddings</dt>
              <dd>
                <code>{model!.embeddingVersion}</code>
              </dd>
            </div>
          </dl>
          {model!.files.length ? (
            <ul>
              {model!.files.map((file) => (
                <li key={file.name}>
                  <code>{file.name}</code>
                  <span>{bytes(file.bytes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Notice kind="error">
              Файлы в каталоге модели не найдены. Бенчмарк покажет ошибку загрузки.
            </Notice>
          )}
        </details>
      </section>

      <section className="model-panel" aria-labelledby="benchmark-title" aria-busy={running}>
        <div className="model-benchmark-heading">
          <div>
            <span className="eyebrow">Реальный запуск на этом компьютере</span>
            <h2 id="benchmark-title">Скорость и понимание синонимов</h2>
            <p>
              {overview.dataset.cases.length} запроса · {overview.dataset.documents.length}{' '}
              документов · синтетические данные
            </p>
          </div>
          <div className="model-actions">
            {report && (
              <button className="btn" onClick={() => download(report, 'model-benchmark.json')}>
                Скачать отчёт
              </button>
            )}
            <button
              className="btn primary"
              disabled={running || starting}
              onClick={() => void start()}
            >
              {starting
                ? 'Запускаем…'
                : running
                  ? 'Тест выполняется…'
                  : report
                    ? 'Запустить повторно'
                    : 'Запустить бенчмарк'}
            </button>
          </div>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {status?.state === 'error' && <Notice kind="error">{status.error}</Notice>}
        {running && (
          <div className="model-progress" role="status" aria-live="polite">
            <div>
              <strong>{phases[status.phase]}</strong>
              <span>
                {elapsed} с · {status.completedQueries} / {status.totalQueries} запросов
              </span>
            </div>
            <progress max={status.totalQueries} value={status.completedQueries} />
            <p>
              Задача продолжится при переключении вкладки. Другие запросы к модели могут увеличить
              время измерения.
            </p>
          </div>
        )}
        {report && (
          <p className="model-run-date">
            {running ? 'Ниже — предыдущий завершённый запуск.' : 'Последний запуск:'}{' '}
            {formatTime(report.completedAt)} · {report.model.environment.cpu} · пакет{' '}
            {report.model.batchSize}
          </p>
        )}
        <div className="model-metrics">
          <div>
            <span>Запрос без кэша · P50</span>
            <strong>
              {report ? number(report.timing.queryMedianMs) : '—'}
              <small>{report && ' мс'}</small>
            </strong>
            <p>Медиана времени векторизации</p>
          </div>
          <div>
            <span>Запрос без кэша · P95</span>
            <strong>
              {report ? number(report.timing.queryP95Ms) : '—'}
              <small>{report && ' мс'}</small>
            </strong>
            <p>95-й перцентиль измерений</p>
          </div>
          <div>
            <span>Синонимы · Top-1</span>
            <strong>{report ? percent(report.byCategory.synonym.top1) : '—'}</strong>
            <p>Ожидаемый ответ на первом месте</p>
          </div>
          <div>
            <span>Все запросы · Top-1</span>
            <strong>{report ? percent(report.accuracy.top1) : '—'}</strong>
            <p>
              {report
                ? `${Math.round(report.accuracy.top1 * report.queryCount)} из ${report.queryCount} правильных первых ответов`
                : 'Результат появится после запуска'}
            </p>
          </div>
        </div>
        {report ? (
          <>
            <div className="model-extra-metrics">
              <span>
                Top-3 <strong>{percent(report.accuracy.top3)}</strong>
              </span>
              <span>
                MRR <strong>{number(report.accuracy.mrr, 3)}</strong>
              </span>
              <span>
                Запросов/с <strong>{number(report.timing.queriesPerSecond)}</strong>
              </span>
              <span>
                Документов/с <strong>{number(report.timing.documentsPerSecond)}</strong>
              </span>
            </div>
            <Results report={report} />
            <details className="model-technical">
              <summary>Подробные измерения времени</summary>
              <dl>
                <div>
                  <dt>
                    {report.timing.modelWasReady
                      ? 'Проверка уже загруженной модели'
                      : 'Загрузка модели с диска'}
                  </dt>
                  <dd>{number(report.timing.modelLoadMs)} мс</dd>
                </div>
                <div>
                  <dt>Отдельный прогрев</dt>
                  <dd>{number(report.timing.warmupMs)} мс</dd>
                </div>
                <div>
                  <dt>Векторизация {report.documentCount} документов</dt>
                  <dd>{number(report.timing.documentEmbeddingMs)} мс</dd>
                </div>
                <div>
                  <dt>Среднее время запроса без кэша</dt>
                  <dd>{number(report.timing.queryMeanMs)} мс</dd>
                </div>
                <div>
                  <dt>Запрос из кэша · медиана {report.timing.cachedQuerySamples} повторов</dt>
                  <dd>{number(report.timing.cachedQueryMedianMs, 3)} мс</dd>
                </div>
                <div>
                  <dt>Весь запуск без записи отчёта</dt>
                  <dd>{number(report.timing.totalMs / 1000)} с</dd>
                </div>
              </dl>
            </details>
          </>
        ) : (
          !running && (
            <p className="model-empty">
              Запустите тест, чтобы получить измеренные показатели скорости и качества.
            </p>
          )
        )}
        <details className="model-technical">
          <summary>Как устроен бенчмарк</summary>
          <p>
            Для каждого запроса вручную выбран один правильный ответ. В корпус включены близкие
            отвлекающие варианты: например, ремонт автомобиля вместо его аренды. Все запросы
            ранжируют все документы по косинусному сходству.
          </p>
          <p>
            Top-1 — доля запросов, где ожидаемый ответ первый; Top-3 — где он в первой тройке. MRR —
            среднее значение 1 / место ожидаемого ответа; 1 означает первое место для всех запросов.
            Перцентили рассчитаны методом ближайшего ранга.
          </p>
          <p>
            Время запроса включает токенизацию, ONNX и нормализацию; кэш принудительно отключён для
            всех основных измерений. Загрузка и прогрев учитываются отдельно. HTTP, SQL и правила
            ранжирования закупок в тест не входят. Запросы выполняются последовательно; запросов/с —
            1000 / среднее время запроса, без проверки параллельной нагрузки.
          </p>
          <p>
            Это небольшой авторский набор на русском языке, а не оценка качества на всех закупках.
            Косинусное сходство не является вероятностью правильного ответа. Тест не обучает модель
            и не использует рабочие Excel-файлы.
          </p>
        </details>
      </section>
      <section className="model-panel">
        <div className="model-benchmark-heading">
          <div>
            <h2>Тестовые данные</h2>
            <p>{overview.dataset.description}</p>
          </div>
          <button
            className="btn"
            onClick={() => download(overview.dataset, 'model-test-data.json')}
          >
            Скачать данные
          </button>
        </div>
        <details className="model-technical">
          <summary>Посмотреть запросы, ответы и отвлекающие варианты</summary>
          <div className="model-dataset">
            {overview.dataset.cases.map((item) => (
              <article key={item.id}>
                <span>
                  {categories[item.category]} · {item.label}
                </span>
                <h3>{item.query}</h3>
                <p>
                  <strong>Ответ:</strong>{' '}
                  {
                    overview.dataset.documents.find((document) => document.id === item.expectedId)
                      ?.text
                  }
                </p>
                <p>
                  <strong>Отвлекающий вариант:</strong>{' '}
                  {
                    overview.dataset.documents.find(
                      (document) =>
                        document.id === item.expectedId.replace('target-', 'distractor-'),
                    )?.text
                  }
                </p>
              </article>
            ))}
          </div>
        </details>
      </section>
    </div>
  );
}
