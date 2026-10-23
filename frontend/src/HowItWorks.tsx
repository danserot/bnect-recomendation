import type {
  Catalog,
  RecommendationFilters,
  RecommendationResponse,
  SupplierProfile,
} from '@bnect/shared';
import { formatTime, Notice } from './ui';

export default function HowItWorks({
  catalog,
  filters,
  profile,
  recommendation,
}: {
  catalog: Catalog;
  filters: RecommendationFilters;
  profile: SupplierProfile;
  recommendation?: RecommendationResponse;
}) {
  const mode =
    filters.regionMode === 'all'
      ? 'Все регионы'
      : filters.regionMode === 'supplier'
        ? 'Регионы поставщика'
        : 'Выбранные регионы';
  const ids =
    filters.regionMode === 'supplier' ? profile.serviceRegionIds : filters.selectedRegionIds;
  const regions = ids.map((id) => catalog.regions.find((item) => item.id === id)?.name ?? id);
  return (
    <div className="explanation-layout">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Понятная механика</span>
          <h1>Как это работает</h1>
          <p className="subtitle">
            От специализации компании до пяти близких закупок — с проверяемыми ограничениями.
          </p>
        </div>
      </div>
      <div className="steps">
        {[
          [
            '01',
            'Описываем предмет',
            'Название, сфера, деятельность, вид закупки и описание составляют стабильный текст.',
          ],
          [
            '02',
            'Получаем embedding',
            'Многоязычная модель превращает русский текст в нормализованный вектор.',
          ],
          [
            '03',
            'Ограничиваем выбор',
            'Регион, сфера, вид, способ закупки и доступность отбирают кандидатов.',
          ],
          [
            '04',
            'Сравниваем векторы',
            'Точный поиск в pgvector возвращает до пяти соседей по косинусному сходству.',
          ],
        ].map(([number, title, description]) => (
          <div className="step" key={number}>
            <span className="step-number">{number}</span>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        ))}
      </div>
      <Notice kind="warning">
        Все демонстрационные тендеры и профили синтетические. Проверка доступности выполняется на
        фиксированную дату: <strong>{formatTime(catalog.demoNow)} (UTC+5)</strong>. Это не сведения
        о закупках, открытых сегодня.
      </Notice>
      <div className="article-grid">
        <section className="panel article">
          <h2>Два разных поисковых запроса</h2>
          <p>
            <strong>Под профиль.</strong> В запрос входит описание специализации, сферы,
            деятельности и виды закупок поставщика. Названия компании недостаточно для
            содержательных рекомендаций.
          </p>
          <p>
            <strong>Похожие закупки.</strong> Выбранный тендер превращается в отдельный
            query-вектор. Его ID исключается из результатов. Активные ограничения поставщика
            применяются так же явно.
          </p>
          <p>
            Векторы запросов формируются с префиксом <code>query:</code>, тендеры индексируются с{' '}
            <code>passage:</code>. Применяются mean pooling и L2-нормализация.
          </p>
          <p>
            Поиск по номеру и названию в каталоге — самостоятельный текстовый поиск, который не
            участвует в расчёте embedding-рейтинга.
          </p>
        </section>
        <section className="panel article">
          <h2>Текущие ограничения</h2>
          <p>
            <strong>География:</strong> {mode}
            {filters.regionMode !== 'all' && ` — ${regions.join(', ') || 'не выбрана'}`}.
          </p>
          <p>
            <strong>После фильтров:</strong>{' '}
            {recommendation
              ? `${recommendation.candidateCount} из ${recommendation.totalCount} тендеров; в выдаче ${recommendation.results.length}.`
              : 'Выполните подбор во вкладке «Закупки», чтобы увидеть число кандидатов.'}
          </p>
          <p>Географический фильтр применяется до выбора top-5.</p>
          <p>
            <strong>Открытые закупки:</strong>{' '}
            {filters.onlyOpen
              ? 'только известный открытый статус с будущим дедлайном относительно демо-даты'
              : 'включая закрытые и закупки с неизвестной доступностью'}
            .
          </p>
          <p>
            Регионы сравниваются по каноническим ID и справочнику алиасов. Астана, г. Астана и
            Нур-Султан — один регион; Алматы и Алматинская область — разные.
          </p>
          <p>
            Пустой список в ограниченном режиме требует выбора. Неизвестный регион доступен только в
            режиме «Все регионы». При пустой выдаче фильтры не ослабляются.
          </p>
        </section>
        <section className="panel article">
          <h2>Рейтинг без скрытых бонусов</h2>
          <p>
            Косинусное сходство вычисляется в исходном пространстве {catalog.model.dimensions}{' '}
            измерений:
          </p>
          <pre>
            <code>
              {
                'similarity(a, b) = dot(a, b) / (norm(a) × norm(b))\n\ndistance = embedding <=> queryVector\nsimilarity = 1 − distance'
              }
            </code>
          </pre>
          <p>
            География определяет доступный набор кандидатов до top-5. Регион и способ закупки не
            добавляют баллы к смысловому сходству. При одинаковом расстоянии используется стабильный
            порядок по ID.
          </p>
          <p>
            Совпавшие поля — наблюдаемые признаки для объяснения. Они не показывают математический
            вклад слов в score. Значение 0.83 не означает 83% вероятности победы или допуска.
          </p>
        </section>
        <section className="panel article">
          <h2>Что известно о данных</h2>
          <ul>
            <li>
              Дата создания не является дедлайном. Без статуса и срока показывается «Доступность
              участия неизвестна».
            </li>
            <li>
              Синтетические статусы и сроки demo-данных нужны только для воспроизводимой проверки
              фильтра.
            </li>
            <li>
              Импорт CSV валидирует строки и обновляет тендеры по номеру без дублей. Режим dry-run
              ничего не записывает.
            </li>
            <li>
              Реальная база поставщиков подключается через отдельный адаптер. Такая интеграция ещё
              не выполнена.
            </li>
            <li>
              Лицензии, квалификация, условия допуска, организаторы и бюджеты этим прототипом не
              проверяются.
            </li>
          </ul>
        </section>
        <section className="panel article full-span">
          <h2>Простая архитектура</h2>
          <div className="architecture">
            <div className="architecture-node">
              React + TypeScript<span>Интерфейс · Vite</span>
            </div>
            <span className="architecture-arrow">→</span>
            <div className="architecture-node">
              Fastify + Zod<span>API · валидация · фильтры</span>
            </div>
            <span className="architecture-arrow">→</span>
            <div className="architecture-node">
              PostgreSQL + pgvector<span>Данные · точный cosine search</span>
            </div>
            <span className="architecture-arrow">↔</span>
            <div className="architecture-node">
              EmbeddingProvider<span>Локальная многоязычная модель</span>
            </div>
          </div>
          <p style={{ marginTop: 22 }}>
            Модель: <code>{catalog.model.id}</code>, размерность:{' '}
            <code>{catalog.model.dimensions}</code>, версия текстового представления:{' '}
            <code>{catalog.model.embeddingVersion}</code>. Модель загружается один раз на процесс;
            первая загрузка может занять время. При недоступной модели система сообщает ошибку и не
            подменяет поиск.
          </p>
          <p>
            Вместе с вектором хранятся modelId, embeddingVersion, contentHash и время индексации.
            Неизменившиеся записи переиспользуются; смена модели или формата требует явной
            переиндексации.
          </p>
          <p>
            PCA обучается на embedding-векторах тендеров и кешируется по составу индекса. Вектор
            профиля проецируется тем же преобразованием. Двумерный график помогает ориентироваться,
            но рейтинг вычисляется в полной размерности.
          </p>
          <p>
            Для большого набора можно перейти на HNSW. Approximate-поиск с фильтрами может потерять
            подходящих соседей и требует измерения полноты и настройки параметров. В текущем
            прототипе используется точный поиск; заявления о производительности без измерений не
            делаются.
          </p>
        </section>
      </div>
    </div>
  );
}
