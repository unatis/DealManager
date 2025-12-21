using DealManager.Models;
using MongoDB.Driver;

namespace DealManager.Services;

public sealed class AiChatHistoryService
{
    private readonly IMongoCollection<AiChatThread> _threads;

    public AiChatHistoryService(MongoSettings settings)
    {
        var clientSettings = MongoClientSettings.FromConnectionString(settings.ConnectionString);
        clientSettings.AllowInsecureTls = true;
        var client = new MongoClient(clientSettings);
        var db = client.GetDatabase(settings.Database);
        _threads = db.GetCollection<AiChatThread>(settings.AiChatsCollection);
    }

    private static string NormTicker(string ticker) => (ticker ?? "").Trim().ToUpperInvariant();

    private FilterDefinition<AiChatThread> ThreadFilter(string userId, string ticker, string? stockId)
    {
        var t = NormTicker(ticker);
        var builder = Builders<AiChatThread>.Filter;
        var baseFilter = builder.Eq(x => x.UserId, userId) & builder.Eq(x => x.Ticker, t);

        if (string.IsNullOrWhiteSpace(stockId))
            return baseFilter & builder.Or(builder.Eq(x => x.StockId, null), builder.Eq(x => x.StockId, ""));

        return baseFilter & builder.Eq(x => x.StockId, stockId);
    }

    public async Task<AiChatThread?> GetThreadAsync(string userId, string ticker, string? stockId)
    {
        var filter = ThreadFilter(userId, ticker, stockId);
        return await _threads.Find(filter).FirstOrDefaultAsync();
    }

    public async Task<IReadOnlyList<AiChatMessage>> GetMessagesAsync(string userId, string ticker, string? stockId, int limit = 100)
    {
        limit = Math.Clamp(limit, 1, 500);
        var thread = await GetThreadAsync(userId, ticker, stockId);
        if (thread?.Messages == null || thread.Messages.Count == 0)
            return Array.Empty<AiChatMessage>();

        // Return last N
        return thread.Messages
            .OrderBy(m => m.CreatedAtUtc)
            .TakeLast(limit)
            .ToList();
    }

    public async Task AppendAsync(string userId, string ticker, string? stockId, params AiChatMessage[] messages)
    {
        if (messages == null || messages.Length == 0)
            return;

        var t = NormTicker(ticker);
        var now = DateTime.UtcNow;
        foreach (var m in messages)
        {
            m.CreatedAtUtc = m.CreatedAtUtc == default ? now : m.CreatedAtUtc;
            m.Role = string.IsNullOrWhiteSpace(m.Role) ? "user" : m.Role.Trim().ToLowerInvariant();
            m.Content ??= "";
        }

        var filter = ThreadFilter(userId, t, stockId);

        var update = Builders<AiChatThread>.Update
            .SetOnInsert(x => x.UserId, userId)
            .SetOnInsert(x => x.Ticker, t)
            .SetOnInsert(x => x.StockId, string.IsNullOrWhiteSpace(stockId) ? null : stockId)
            .SetOnInsert(x => x.CreatedAtUtc, now)
            .Set(x => x.UpdatedAtUtc, now)
            .PushEach(x => x.Messages, messages);

        await _threads.UpdateOneAsync(filter, update, new UpdateOptions { IsUpsert = true });
    }

    public Task ClearAsync(string userId, string ticker, string? stockId)
    {
        var filter = ThreadFilter(userId, ticker, stockId);
        var update = Builders<AiChatThread>.Update
            .Set(x => x.Messages, new List<AiChatMessage>())
            .Set(x => x.UpdatedAtUtc, DateTime.UtcNow);

        return _threads.UpdateOneAsync(filter, update, new UpdateOptions { IsUpsert = true });
    }
}


