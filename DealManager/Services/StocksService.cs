using DealManager.Models;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class StocksService
    {
        private readonly IMongoCollection<Stock> _stocks;

        public StocksService(MongoSettings settings)
        {
            var clientSettings = MongoClientSettings.FromConnectionString(settings.ConnectionString);
            clientSettings.AllowInsecureTls = true;
            var client = new MongoClient(clientSettings);
            var db = client.GetDatabase(settings.Database);
            _stocks = db.GetCollection<Stock>(settings.StocksCollection);
        }

        public Task<List<Stock>> GetAllForOwnerAsync(string ownerId) =>
            _stocks.Find(s => s.OwnerId == ownerId)
                   .SortBy(s => s.Order)
                   .ToListAsync();

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

        public async Task UpdateAsync(string id, string ownerId, Stock stock)
        {
            var filter = Builders<Stock>.Filter.And(
                Builders<Stock>.Filter.Eq(s => s.Id, id),
                Builders<Stock>.Filter.Eq(s => s.OwnerId, ownerId)
            );
            
            await _stocks.ReplaceOneAsync(filter, stock);
        }

        public Task<Stock?> GetByIdAsync(string id, string ownerId)
        {
            return _stocks
                .Find(s => s.Id == id && s.OwnerId == ownerId)
                .FirstOrDefaultAsync();
        }

        public Task UpdateOrderAsync(string ownerId, string stockId, int order)
        {
            var filter = Builders<Stock>.Filter.And(
                Builders<Stock>.Filter.Eq(s => s.OwnerId, ownerId),
                Builders<Stock>.Filter.Eq(s => s.Id, stockId)
            );

            var update = Builders<Stock>.Update.Set(s => s.Order, order);
            return _stocks.UpdateOneAsync(filter, update);
        }
    }
}
