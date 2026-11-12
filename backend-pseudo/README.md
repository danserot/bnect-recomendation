# Pseudo .NET backend for tender recommendations

Эта папка изолирована от существующего TypeScript backend. Это рабочий каркас
архитектуры для последующей замены на настоящий ASP.NET Core сервис: он не
подключается к текущему `compose.yaml`, не меняет существующие таблицы и
использует in-memory данные вместо реальных БД, но уже содержит локальные
ONNX-веса `multilingual-e5-small`.

## Что демонстрирует каркас

- два независимых источника: `internal` и `partner`;
- один запрос `/api/tenders/{id}/similar` параллельно обращается к обоим
  источникам;
- каждый источник фильтрует только активные тендеры по `ApplicationDeadline`;
- текст тендера преобразуется в вектор через интерфейс `IEmbeddingModel`;
- результаты объединяются, сортируются по cosine similarity и ограничиваются
  пятью строками;
- `POST /api/tenders` имитирует создание тендера и запись векторного индекса;
- `POST /api/maintenance/cleanup-expired` удаляет просроченные векторы;
- локальная модель `Xenova/multilingual-e5-small` выполняется через ONNX Runtime
  CPU и возвращает 384-мерные нормализованные векторы;
- Dockerfile готовит отдельный контейнер, но не запускается автоматически.

## Локальная embedding-модель

Модель скопирована из основного проекта в
`models/Xenova/multilingual-e5-small/761b726/`:

- `onnx/model_quantized.onnx` — CPU Q8-веса;
- `tokenizer.json` и `tokenizer_config.json` — словарь и настройки токенизации;
- `config.json` — конфигурация модели.

Префикс `query:` используется для исходного тендера, а `passage:` — для
тендеров-кандидатов. После ONNX-инференса выполняется mean pooling и L2
нормализация, поэтому cosine similarity можно считать обычным скалярным
произведением.

Для компактности .NET-каркас использует управляемый адаптер unigram-словаря из
`tokenizer.json`. Перед production-сравнением с текущим TypeScript backend нужно
заменить его на точный Hugging Face/SentencePiece tokenizer: нормализация и
Viterbi-разбиение должны полностью совпадать с исходным Transformers.js.

## Что заменить перед подключением

1. `InMemoryTenderSource` заменить на два адаптера PostgreSQL или HTTP API.
   Для production нужны разные connection strings:
   `INTERNAL_DATABASE_URL` и `PARTNER_DATABASE_URL`.
2. `MultilingualE5EmbeddingModel` подключить к production-хранилищу моделей
   `/models` вместо поставки больших весов вместе с исходным кодом.
3. В `TenderRecord` согласовать реальные названия полей и внешний ID.
4. Добавить миграцию `pgvector` с колонкой `vector(384)`, индексом и
   метаданными `model_id`, `embedding_version`, `embedded_at`.
5. Добавить авторизацию между сервисами и ограничения доступа к maintenance
   endpoint.

## Запуск

```powershell
dotnet run --project backend-pseudo
curl http://localhost:5080/api/health
curl http://localhost:5080/api/tenders/internal-1/similar
```

```powershell
docker build -f backend-pseudo/Dockerfile -t bnect-pseudo-backend .
docker run --rm -p 5080:8080 bnect-pseudo-backend
```

Это именно псевдо-бэкенд: его задача показать границы модулей и контракт
интеграции, а не заменить production database/model без настройки.
