using System.Text;
using System.Text.Json;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

var builder = WebApplication.CreateBuilder(args);

// Два экземпляра одного адаптера имитируют две независимые базы:
// внутреннюю базу платформы и базу партнера.
builder.Services.AddSingleton<ITenderSource>(new InMemoryTenderSource("internal"));
builder.Services.AddSingleton<ITenderSource>(new InMemoryTenderSource("partner"));
builder.Services.AddSingleton<IEmbeddingModel, MultilingualE5EmbeddingModel>();
builder.Services.AddSingleton<RecommendationService>();

var app = builder.Build();

// Техническая проверка доступности сервиса и подключенных источников.
app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    mode = "pseudo",
    sources = new[] { "internal", "partner" }
}));

// Возвращает сведения о текущей embedding-модели.
app.MapGet("/api/model", (IEmbeddingModel model) => Results.Ok(model.Describe()));

// При открытии страницы тендера этот endpoint строит подборку похожих
// тендеров из обеих баз и возвращает не более пяти результатов.
app.MapGet("/api/tenders/{id}/similar", async (
    string id,
    RecommendationService service,
    CancellationToken cancellationToken) =>
{
    var result = await service.FindSimilarAsync(id, DateTimeOffset.UtcNow, cancellationToken);
    return result is null ? Results.NotFound() : Results.Ok(result);
});

// Создание тендера: сначала формируется вектор текста, затем запись сохраняется
// в соответствующий источник. В production здесь будет транзакция БД.
app.MapPost("/api/tenders", async (
    TenderRecord tender,
    IEnumerable<ITenderSource> sources,
    IEmbeddingModel model,
    CancellationToken cancellationToken) =>
{
    var stored = tender with
    {
        Embedding = await model.CreateAsync(tender.SearchText, isQuery: false, cancellationToken: cancellationToken),
        EmbeddedAt = DateTimeOffset.UtcNow
    };
    var target = sources.Single(source =>
        source.Name.Equals(stored.Source, StringComparison.OrdinalIgnoreCase));
    await target.UpsertAsync(stored, cancellationToken);
    return Results.Created($"/api/tenders/{stored.Id}", stored);
});

// Планировщик должен вызывать этот endpoint ежедневно. Просроченные векторы
// удаляются, чтобы они не участвовали в будущих рекомендациях.
app.MapPost("/api/maintenance/cleanup-expired", (
    IEnumerable<ITenderSource> sources) =>
{
    var removed = sources.Sum(source => source.RemoveExpiredVectors(DateTimeOffset.UtcNow));
    return Results.Ok(new { removed });
});

app.Run();

public sealed record TenderRecord(
    string Id,
    string Source,
    string Title,
    string Description,
    DateTimeOffset ApplicationDeadline,
    string Status,
    float[]? Embedding = null,
    DateTimeOffset? EmbeddedAt = null)
{
    // Активным считается только открытый тендер с будущим сроком подачи.
    public bool IsActive(DateTimeOffset now) =>
        Status.Equals("open", StringComparison.OrdinalIgnoreCase) &&
        ApplicationDeadline > now;

    public string SearchText => $"{Title}. {Description}";
}

public sealed record SimilarTender(
    TenderRecord Tender,
    double Similarity,
    string Source);

public sealed record SimilarResponse(
    string QueryTenderId,
    DateTimeOffset EvaluatedAt,
    IReadOnlyList<SimilarTender> Results);

public interface ITenderSource
{
    string Name { get; }

    Task<IReadOnlyList<TenderRecord>> GetActiveAsync(
        DateTimeOffset now,
        CancellationToken cancellationToken);

    Task<TenderRecord?> GetAsync(string id, CancellationToken cancellationToken);
    Task UpsertAsync(TenderRecord tender, CancellationToken cancellationToken);
    int RemoveExpiredVectors(DateTimeOffset now);
}

public interface IEmbeddingModel
{
    Task<float[]> CreateAsync(string text, bool isQuery, CancellationToken cancellationToken);
    object Describe();
}

public sealed class RecommendationService(
    IEnumerable<ITenderSource> sources,
    IEmbeddingModel model)
{
    public async Task<SimilarResponse?> FindSimilarAsync(
        string id,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // Ищем исходный тендер в обоих источниках одновременно.
        var anchorResults = await Task.WhenAll(
            sources.Select(source => source.GetAsync(id, cancellationToken)));
        var anchor = anchorResults.FirstOrDefault(item => item is not null);
        if (anchor is null) return null;

        // Вектор исходного тендера используется как поисковый запрос.
        var query = await model.CreateAsync(anchor.SearchText, isQuery: true, cancellationToken: cancellationToken);
        // Каждый источник самостоятельно применяет фильтр активных тендеров.
        var activeBySource = await Task.WhenAll(
            sources.Select(source => source.GetActiveAsync(now, cancellationToken)));
        var active = new List<TenderRecord>();
        // Для старых записей, у которых еще нет вектора, создаем его лениво.
        // При реальной интеграции это обычно выполняется фоновой очередью.
        foreach (var item in activeBySource.SelectMany(items => items))
        {
            var stored = item.Embedding is not null
                ? item
                : item with
            {
                Embedding = await model.CreateAsync(item.SearchText, isQuery: false, cancellationToken: cancellationToken),
                EmbeddedAt = now
            };
            if (item.Embedding is null)
            {
                var owner = sources.Single(source =>
                    source.Name.Equals(item.Source, StringComparison.OrdinalIgnoreCase));
                await owner.UpsertAsync(stored, cancellationToken);
            }
            active.Add(stored);
        }

        // Объединяем результаты двух баз, исключаем исходный тендер,
        // сортируем по косинусной близости и оставляем топ-5.
        var results = active
            .Where(item => item.Id != id && item.Embedding is { Length: > 0 })
            .Select(item => new SimilarTender(item, Cosine(query, item.Embedding!), item.Source))
            .OrderByDescending(item => item.Similarity)
            .ThenBy(item => item.Tender.Id, StringComparer.Ordinal)
            .Take(5)
            .ToArray();

        return new SimilarResponse(id, now, results);
    }

    // Для нормализованных векторов cosine similarity показывает семантическую
    // близость: чем значение ближе к 1, тем тексты похожее.
    private static double Cosine(float[] left, float[] right)
    {
        if (left.Length != right.Length || left.Length == 0) return 0;
        double dot = 0;
        double leftNorm = 0;
        double rightNorm = 0;
        for (var i = 0; i < left.Length; i++)
        {
            dot += left[i] * right[i];
            leftNorm += left[i] * left[i];
            rightNorm += right[i] * right[i];
        }
        return leftNorm == 0 || rightNorm == 0
            ? 0
            : dot / Math.Sqrt(leftNorm * rightNorm);
    }
}

public sealed class InMemoryTenderSource : ITenderSource
{
    private readonly Dictionary<string, TenderRecord> tenders;

    public InMemoryTenderSource(string name)
    {
        Name = name;
        tenders = name == "internal"
            ? new Dictionary<string, TenderRecord>
            {
                ["internal-1"] = New("internal-1", name, "Поставка серверного оборудования"),
                ["internal-2"] = New("internal-2", name, "Модернизация серверной инфраструктуры")
            }
            : new Dictionary<string, TenderRecord>
            {
                ["partner-1"] = New("partner-1", name, "Поставка вычислительных серверов"),
                ["partner-2"] = New("partner-2", name, "Ремонт административного здания")
            };
    }

    public string Name { get; }

    // В production этот метод должен выполнять SQL/API-запрос с фильтром:
    // status = 'open' AND application_deadline > current_timestamp.
    public Task<IReadOnlyList<TenderRecord>> GetActiveAsync(
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var result = tenders.Values
            .Where(item => item.IsActive(now))
            .ToArray();
        return Task.FromResult<IReadOnlyList<TenderRecord>>(result);
    }

    public Task<TenderRecord?> GetAsync(string id, CancellationToken cancellationToken)
    {
        tenders.TryGetValue(id, out var tender);
        return Task.FromResult(tender);
    }

    // Сейчас запись хранится в памяти; здесь будет INSERT/UPDATE в конкретную БД.
    public Task UpsertAsync(TenderRecord tender, CancellationToken cancellationToken)
    {
        tenders[tender.Id] = tender;
        return Task.CompletedTask;
    }

    // Обнуляем только embedding-данные просроченных тендеров, сам тендер
    // остается в каталоге и может быть нужен для истории.
    public int RemoveExpiredVectors(DateTimeOffset now)
    {
        var keys = tenders.Values
            .Where(item => item.ApplicationDeadline <= now && item.Embedding is not null)
            .Select(item => item.Id)
            .ToArray();
        foreach (var key in keys)
        {
            if (tenders.TryGetValue(key, out var tender))
                tenders[key] = tender with { Embedding = null, EmbeddedAt = null };
        }
        return keys.Length;
    }

    private static TenderRecord New(string id, string source, string title) =>
        new(id, source, title, "Демонстрационное описание закупки",
            DateTimeOffset.UtcNow.AddDays(30), "open");
}

public sealed class MultilingualE5EmbeddingModel : IEmbeddingModel, IDisposable
{
    public const int Dimensions = 384;
    private const int MaxTokens = 512;
    private readonly InferenceSession session;
    private readonly Dictionary<string, int> vocabulary;

    public MultilingualE5EmbeddingModel()
    {
        var root = Environment.GetEnvironmentVariable("EMBEDDING_MODEL_DIR")
            ?? Path.Combine(AppContext.BaseDirectory, "models");
        var modelPath = Path.Combine(root, "Xenova", "multilingual-e5-small",
            "761b726", "onnx", "model_quantized.onnx");
        var tokenizerPath = Path.Combine(root, "Xenova", "multilingual-e5-small",
            "761b726", "tokenizer.json");
        session = new InferenceSession(modelPath);
        using var document = JsonDocument.Parse(File.ReadAllText(tokenizerPath));
        vocabulary = document.RootElement.GetProperty("model").GetProperty("vocab")
            .EnumerateArray()
            .Select((item, id) => new { Piece = item[0].GetString()!, Id = id })
            .ToDictionary(item => item.Piece, item => item.Id, StringComparer.Ordinal);
    }

    public Task<float[]> CreateAsync(string text, bool isQuery, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var ids = Encode((isQuery ? "query: " : "passage: ") + text);
        var inputIds = new DenseTensor<long>(new[] { 1, ids.Length });
        var attentionMask = new DenseTensor<long>(new[] { 1, ids.Length });
        var tokenTypeIds = new DenseTensor<long>(new[] { 1, ids.Length });
        for (var i = 0; i < ids.Length; i++)
        {
            inputIds[0, i] = ids[i];
            attentionMask[0, i] = 1;
            tokenTypeIds[0, i] = 0;
        }

        using var results = session.Run(new[]
        {
            NamedOnnxValue.CreateFromTensor("input_ids", inputIds),
            NamedOnnxValue.CreateFromTensor("attention_mask", attentionMask),
            NamedOnnxValue.CreateFromTensor("token_type_ids", tokenTypeIds)
        });
        var hidden = results.First().AsTensor<float>();
        var vector = new float[Dimensions];
        for (var token = 0; token < ids.Length; token++)
            for (var dimension = 0; dimension < Dimensions; dimension++)
                vector[dimension] += hidden[0, token, dimension];
        var norm = Math.Sqrt(vector.Sum(value => value * value));
        if (norm > 0)
            for (var dimension = 0; dimension < Dimensions; dimension++)
                vector[dimension] = (float)(vector[dimension] / norm);
        return Task.FromResult(vector);
    }

    public object Describe() => new
    {
        id = "Xenova/multilingual-e5-small",
        revision = "761b726",
        dimensions = Dimensions,
        runtime = "ONNX Runtime CPU",
        quantization = "q8",
        prefixes = new[] { "query:", "passage:" },
        maxTokens = MaxTokens
    };

    public void Dispose() => session.Dispose();

    private long[] Encode(string text)
    {
        var normalized = "▁" + text.Trim().Replace(' ', '▁');
        var ids = new List<long> { vocabulary["<s>"] };
        for (var position = 0; position < normalized.Length && ids.Count < MaxTokens - 1;)
        {
            var match = normalized.Length - position;
            while (match > 0 && !vocabulary.ContainsKey(normalized.Substring(position, match)))
                match--;
            if (match == 0)
            {
                ids.Add(vocabulary["<unk>"]);
                position++;
            }
            else
            {
                ids.Add(vocabulary[normalized.Substring(position, match)]);
                position += match;
            }
        }
        ids.Add(vocabulary["</s>"]);
        return ids.ToArray();
    }
}
