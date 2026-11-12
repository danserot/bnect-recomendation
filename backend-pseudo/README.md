# Backend для рекомендаций тендеров

Изолированное ASP.NET Core приложение для поиска похожих тендеров с помощью
embedding-векторов и cosine similarity.

Приложение демонстрирует полный сценарий:

1. тендер сохраняется во внутренний или партнерский источник;
2. для текста тендера создается embedding-вектор;
3. при открытии тендера выполняется поиск активных кандидатов;
4. кандидаты из двух источников объединяются;
5. результаты сортируются по сходству;
6. пользователю возвращаются максимум пять похожих тендеров.

Сейчас источники данных реализованы в памяти. Это позволяет запускать приложение
без PostgreSQL и внешних API, но структура интерфейсов подготовлена для замены
демо-источников на реальные базы данных или HTTP-сервисы.

## Архитектура

### Источники тендеров

Приложение регистрирует два независимых экземпляра `ITenderSource`:

- `internal` — внутренняя база тендеров;
- `partner` — база или API партнера.

При запросе похожих тендеров приложение параллельно обращается к обоим
источникам. Каждый источник возвращает только активные записи:

- `Status = "open"`;
- `ApplicationDeadline` позже текущего времени.

В production `InMemoryTenderSource` следует заменить двумя адаптерами. Каждый
адаптер должен самостоятельно отвечать за подключение, авторизацию, таймауты,
маппинг внешних DTO и фильтрацию данных своего источника.

### Embedding-модель

Используется модель:

```text
Xenova/multilingual-e5-small
revision: 761b726
dimensions: 384
runtime: ONNX Runtime CPU
quantization: q8
```

Модель преобразует текст в числовой вектор размерностью 384. Чем ближе два
нормализованных вектора, тем выше семантическое сходство их текстов.

Для E5 применяются разные префиксы:

- `query:` — для текста выбранного тендера;
- `passage:` — для тендеров-кандидатов.

После получения результата выполняются:

1. mean pooling скрытых состояний по токенам;
2. L2-нормализация вектора;
3. сравнение через cosine similarity.

В проекте используется локальный ONNX-файл. Сетевая загрузка модели во время
работы приложения не выполняется.

### Векторный поиск

При запросе `/api/tenders/{id}/similar`:

1. исходный тендер ищется в обоих источниках;
2. его текст преобразуется в `query` embedding;
3. из обоих источников запрашиваются активные тендеры;
4. тендеры без embedding получают его перед сравнением;
5. исходный тендер исключается из выдачи;
6. вычисляется cosine similarity;
7. результаты сортируются по убыванию сходства;
8. при равенстве используется сортировка по ID;
9. возвращаются первые пять результатов.

## Структура файлов

```text
backend-pseudo/
├── Program.cs             # API, модели данных, источники и поиск
├── PseudoBackend.csproj   # .NET-проект и NuGet-зависимости
├── Dockerfile             # сборка production-контейнера
├── compose.yaml           # локальный Docker Compose запуск
├── .gitignore             # исключает build-файлы и веса модели
└── models/                # локальный каталог модели, не хранится в Git
```

Основные компоненты в `Program.cs`:

- `TenderRecord` — модель тендера;
- `ITenderSource` — контракт источника данных;
- `InMemoryTenderSource` — демонстрационный источник;
- `IEmbeddingModel` — контракт embedding-модели;
- `MultilingualE5EmbeddingModel` — ONNX-инференс;
- `RecommendationService` — бизнес-логика рекомендаций.

## API

### Проверка состояния

```http
GET /api/health
```

Пример ответа:

```json
{
  "status": "ok",
  "mode": "pseudo",
  "sources": ["internal", "partner"]
}
```

### Информация о модели

```http
GET /api/model
```

Возвращает идентификатор модели, ревизию, размерность, runtime, квантизацию и
используемые префиксы.

### Похожие тендеры

```http
GET /api/tenders/{id}/similar
```

Пример:

```powershell
curl http://localhost:5080/api/tenders/internal-1/similar
```

Пример структуры ответа:

```json
{
  "queryTenderId": "internal-1",
  "evaluatedAt": "2026-11-12T08:00:00Z",
  "results": [
    {
      "tender": {
        "id": "partner-1",
        "source": "partner",
        "title": "Поставка вычислительных серверов"
      },
      "similarity": 0.87,
      "source": "partner"
    }
  ]
}
```

Если тендер не найден, API возвращает `404`.

### Создание тендера

```http
POST /api/tenders
Content-Type: application/json
```

Пример:

```json
{
  "id": "partner-100",
  "source": "partner",
  "title": "Поставка серверного оборудования",
  "description": "Поставка и настройка серверов для дата-центра",
  "applicationDeadline": "2027-01-30T12:00:00Z",
  "status": "open"
}
```

При создании:

1. выбирается источник по полю `source`;
2. текст `title + description` передается в embedding-модель;
3. результат сохраняется в поле `Embedding`;
4. время создания сохраняется в `EmbeddedAt`;
5. запись сохраняется в выбранном источнике.

В production запись тендера и его embedding желательно сохранять одной
транзакцией. Если модель недоступна, тендер не должен считаться полностью
проиндексированным.

### Очистка просроченных векторов

```http
POST /api/maintenance/cleanup-expired
```

Endpoint удаляет только embedding у тендеров, срок подачи которых истек.
Сам тендер остается в источнике для истории и отчетности.

В production endpoint следует запускать планировщиком один раз в сутки.
Также необходимо защитить его авторизацией, поскольку это административная
операция.

## Подготовка модели

В каталоге модели должны находиться:

```text
models/
└── Xenova/
    └── multilingual-e5-small/
        └── 761b726/
            ├── config.json
            ├── tokenizer.json
            ├── tokenizer_config.json
            └── onnx/
                └── model_quantized.onnx
```

ONNX-файл не хранится в Git из-за ограничения GitHub в 100 МБ. Для локального
запуска положите модель в каталог `backend-pseudo/models`.

Другой путь можно указать переменной:

```powershell
$env:EMBEDDING_MODEL_DIR = "D:\models"
```

Ожидаемая структура внутри указанного каталога остается такой же:

```text
D:\models\Xenova\multilingual-e5-small\761b726\...
```

Если модель отсутствует или повреждена, приложение не сможет создать
`MultilingualE5EmbeddingModel`, поэтому перед запуском необходимо проверить
наличие `model_quantized.onnx` и `tokenizer.json`.

## Запуск локально

Требования:

- .NET SDK 8;
- локальные файлы модели;
- Windows, Linux или macOS с поддержкой .NET 8.

Запуск:

```powershell
dotnet restore backend-pseudo\PseudoBackend.csproj
dotnet run --project backend-pseudo\PseudoBackend.csproj --urls http://localhost:5080
```

Проверка:

```powershell
curl http://localhost:5080/api/health
curl http://localhost:5080/api/model
curl http://localhost:5080/api/tenders/internal-1/similar
```

## Запуск через Docker Compose

Сначала убедитесь, что модель находится в:

```text
backend-pseudo/models/Xenova/multilingual-e5-small/761b726/
```

Затем из корня репозитория выполните:

```powershell
docker compose -f backend-pseudo\compose.yaml up --build
```

В compose-файле каталог `models` монтируется в контейнер как `/models:ro`.
Режим `read-only` не позволяет приложению случайно изменить веса модели.

Проверка контейнера:

```powershell
curl http://localhost:5080/api/health
curl http://localhost:5080/api/model
```

Остановка:

```powershell
docker compose -f backend-pseudo\compose.yaml down
```

## Что заменить для production

### Реальные базы данных

Заменить `InMemoryTenderSource` на реализации `ITenderSource`:

- `InternalTenderSource` для внутренней базы;
- `PartnerTenderSource` для партнерского API или базы.

Не следует объединять доступ к двум базам в одном SQL-репозитории, если у них
разные владельцы, схемы или политики доступа. Каждый адаптер должен возвращать
единый `TenderRecord`.

### Хранилище векторов

Для production рекомендуется PostgreSQL с расширением `pgvector`.

Минимальные поля:

```sql
id                  text primary key,
embedding           vector(384) not null,
model_id            text not null,
embedding_version   text not null,
embedded_at         timestamptz not null,
content_hash        text not null
```

`content_hash` нужен, чтобы не пересчитывать embedding, если текст тендера не
изменился. При смене модели или версии текста нужно выполнить полную
переиндексацию.

### Надежность

Перед production-подключением необходимо добавить:

- таймауты для обоих источников;
- retry только для безопасных операций;
- circuit breaker для недоступного партнерского API;
- логирование времени запроса каждого источника;
- correlation ID;
- авторизацию и secrets через переменные окружения;
- health checks базы, партнерского API и embedding-модели;
- фоновую очередь для массовой индексации;
- ограничение размера входного текста;
- защиту административного cleanup endpoint.

## Ограничения текущей версии

Это демонстрационный backend:

- данные хранятся только в памяти и исчезают после перезапуска;
- нет настоящего PostgreSQL и pgvector;
- нет авторизации;
- нет фоновой очереди;
- нет retry и circuit breaker;
- tokenizer реализует минимальный совместимый адаптер и требует проверки
  против эталонной реализации Transformers.js перед production;
- модель работает на CPU, поэтому массовую индексацию следует выполнять
  отдельным worker-процессом.

Назначение приложения — показать понятный контракт и разделение компонентов,
которые затем можно заменить production-реализациями без изменения API
рекомендаций.
