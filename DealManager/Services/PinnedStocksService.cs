using DealManager.Models;
using MongoDB.Driver;

namespace DealManager.Services
{
    /// <summary>
    /// Сервис для работы с pinned-акциями (отдельно от основного списка Stocks).
    /// </summary>
    public class PinnedStocksService
    {
        private readonly IMongoCollection<PinnedStock> _pinned;

        public PinnedStocksService(MongoSettings settings)
        {
            var clientSettings = MongoClientSettings.FromConnectionString(settings.ConnectionString);
            clientSettings.AllowInsecureTls = true;
            var client = new MongoClient(clientSettings);
            var db = client.GetDatabase(settings.Database);

            var collectionName = string.IsNullOrWhiteSpace(settings.PinnedStocksCollection)
                ? "pinned_stocks"
                : settings.PinnedStocksCollection;

            _pinned = db.GetCollection<PinnedStock>(collectionName);
        }

        public Task<List<PinnedStock>> GetAllForOwnerAsync(string ownerId) =>
            _pinned.Find(x => x.OwnerId == ownerId)
                   .SortBy(x => x.Order)
                   .ToListAsync();

        public async Task<PinnedStock> CreateAsync(string ownerId, string ticker)
        {
            // найти последний order для этого пользователя
            var last = await _pinned
                .Find(x => x.OwnerId == ownerId)
                .SortByDescending(x => x.Order)
                .FirstOrDefaultAsync();

            var pinned = new PinnedStock
            {
                OwnerId = ownerId,
                Ticker = ticker.ToUpperInvariant().Trim(),
                Order = last == null ? 0 : last.Order + 1
            };

            await _pinned.InsertOneAsync(pinned);
            return pinned;
        }

        public async Task<bool> DeleteAsync(string id, string ownerId)
        {
            var res = await _pinned.DeleteOneAsync(x => x.Id == id && x.OwnerId == ownerId);
            return res.DeletedCount > 0;
        }

        public async Task UpdateOrderAsync(string ownerId, IList<string> orderedIds)
        {
            if (orderedIds == null || orderedIds.Count == 0) return;

            int order = 0;
            foreach (var id in orderedIds)
            {
                var filter = Builders<PinnedStock>.Filter.And(
                    Builders<PinnedStock>.Filter.Eq(x => x.OwnerId, ownerId),
                    Builders<PinnedStock>.Filter.Eq(x => x.Id, id)
                );

                var update = Builders<PinnedStock>.Update.Set(x => x.Order, order++);
                await _pinned.UpdateOneAsync(filter, update);
            }
        }
    }
}



