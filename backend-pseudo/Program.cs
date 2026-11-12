using System.Security.Cryptography;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<ITenderSource>(new InMemoryTenderSource("internal"));
builder.Services.AddSingleton<ITenderSource>(new InMemoryTenderSource("partner"));
builder.Services.AddSingleton<IEmbeddingModel, DeterministicEmbeddingModel>();
builder.Services.AddSingleton<RecommendationService>();

var app = builder.Build();

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    mode = "pseudo",
    sources = new[] { "internal", "partner" }
}));

app.MapGet("/api/model", (IEmbeddingModel model) => Results.Ok(model.Describe()));

app.MapGet("/api/tenders/{id}/similar", async (
    string id,
    RecommendationService service,
    CancellationToken cancellationToken) =>
{
    var result = await service.FindSimilarAsync(id, DateTimeOffset.UtcNow, cancellationToken);
    return result is null ? Results.NotFound() : Results.Ok(result);
});

app.MapPost("/api/tenders", async (
    TenderRecord tender,
    IEnumerable<ITenderSource> sources,
    IEmbeddingModel model,
    CancellationToken cancellationToken) =>
{
    var stored = tender with
    {
        Embedding = await model.CreateAsync(tender.SearchText, cancellationToken),
        EmbeddedAt = DateTimeOffset.UtcNow
    };
    var target = sources.Single(source =>
        source.Name.Equals(stored.Source, StringComparison.OrdinalIgnoreCase));
    await target.UpsertAsync(stored, cancellationToken);
    return Results.Created($"/api/tenders/{stored.Id}", stored);
});

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
    Task<float[]> CreateAsync(string text, CancellationToken cancellationToken);
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
        var anchorResults = await Task.WhenAll(
            sources.Select(source => source.GetAsync(id, cancellationToken)));
        var anchor = anchorResults.FirstOrDefault(item => item is not null);
        if (anchor is null) return null;

        var query = await model.CreateAsync(anchor.SearchText, cancellationToken);
        var activeBySource = await Task.WhenAll(
            sources.Select(source => source.GetActiveAsync(now, cancellationToken)));
        var active = new List<TenderRecord>();
        foreach (var item in activeBySource.SelectMany(items => items))
        {
            var stored = item.Embedding is not null
                ? item
                : item with
            {
                Embedding = await model.CreateAsync(item.SearchText, cancellationToken),
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

        var results = active
            .Where(item => item.Id != id && item.Embedding is { Length: > 0 })
            .Select(item => new SimilarTender(item, Cosine(query, item.Embedding!), item.Source))
            .OrderByDescending(item => item.Similarity)
            .ThenBy(item => item.Tender.Id, StringComparer.Ordinal)
            .Take(5)
            .ToArray();

        return new SimilarResponse(id, now, results);
    }

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

    public Task UpsertAsync(TenderRecord tender, CancellationToken cancellationToken)
    {
        tenders[tender.Id] = tender;
        return Task.CompletedTask;
    }

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

public sealed class DeterministicEmbeddingModel : IEmbeddingModel
{
    public const int Dimensions = 32;

    public Task<float[]> CreateAsync(string text, CancellationToken cancellationToken)
    {
        var vector = new float[Dimensions];
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(text.Trim()));
        for (var i = 0; i < vector.Length; i++)
            vector[i] = (bytes[i % bytes.Length] - 128) / 128f;
        var norm = Math.Sqrt(vector.Sum(value => value * value));
        if (norm > 0)
            for (var i = 0; i < vector.Length; i++)
                vector[i] = (float)(vector[i] / norm);
        return Task.FromResult(vector);
    }

    public object Describe() => new
    {
        id = "pseudo-deterministic",
        dimensions = Dimensions,
        productionReplacement = "ONNX/HuggingFace multilingual-e5-small",
        warning = "Это детерминированная заглушка, не ML-модель."
    };
}
