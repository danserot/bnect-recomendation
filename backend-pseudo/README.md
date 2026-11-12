# Pseudo .NET backend for tender recommendations

Эта папка изолирована от существующего TypeScript backend. Это рабочий каркас
архитектуры для последующей замены на настоящий ASP.NET Core сервис: он не
подключается к текущему `compose.yaml`, не меняет существующие таблицы и
использует in-memory данные вместо реальных БД и embedding-весов.

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
- Dockerfile готовит отдельный контейнер, но не запускается автоматически.

## Что заменить перед подключением

1. `InMemoryTenderSource` заменить на два адаптера PostgreSQL или HTTP API.
   Для production нужны разные connection strings:
   `INTERNAL_DATABASE_URL` и `PARTNER_DATABASE_URL`.
2. `DeterministicEmbeddingModel` заменить на ONNX/Hugging Face модель с
   фиксированной размерностью и версией. Веса следует монтировать в
   `/models`, а не хранить в Git.
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
