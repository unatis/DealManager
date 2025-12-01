using DealManager.Models;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class StocksService
    {
        private readonly IMongoCollection<Stock> _stocks;

        public StocksService(MongoSettings settings)
        {
            var client = new MongoClient(settings.ConnectionString);
            var db = client.GetDatabase(settings.Database);
            _stocks = db.GetCollection<Stock>(settings.StocksCollection);
        }

        public Task<List<Stock>> GetAllForOwnerAsync(string ownerId) =>
            _stocks.Find(s => s.OwnerId == ownerId).ToListAsync();

        public Task CreateAsync(Stock stock) =>
            _stocks.InsertOneAsync(stock);

        public Task DeleteAsync(string id, string ownerId) =>
            _stocks.DeleteOneAsync(s => s.Id == id && s.OwnerId == ownerId);

        public async Task<bool> ExistsForOwnerAsync(string ownerId, string ticker)
        {
            var norm = (ticker ?? "").Trim().ToUpperInvariant();

            var filter = Builders<Stock>.Filter.And(
                Builders<Stock>.Filter.Eq(s => s.OwnerId, ownerId),
                Builders<Stock>.Filter.Eq(s => s.Ticker, norm)
            );

            return await _stocks.Find(filter).AnyAsync();
        }

        public Task<bool> ExistsForUserAsync(string userId, string ticker)
        {
            var norm = (ticker ?? "").Trim().ToUpperInvariant();

            return _stocks
                .Find(s => s.OwnerId == userId && s.Ticker == norm)
                .AnyAsync();
        }
    }
}
