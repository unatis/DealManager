using DealManager.Models;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class WarningsService
    {
        private readonly IMongoCollection<Warning> _warnings;

        public WarningsService(MongoSettings settings)
        {
            var clientSettings = MongoClientSettings.FromConnectionString(settings.ConnectionString);
            clientSettings.AllowInsecureTls = true;
            var client = new MongoClient(clientSettings);
            var db = client.GetDatabase(settings.Database);
            _warnings = db.GetCollection<Warning>(settings.WarningsCollection);
        }

        public async Task UpsertWarningAsync(string ownerId, string ticker, bool regularShareVolume)
        {
            var filter = Builders<Warning>.Filter.And(
                Builders<Warning>.Filter.Eq(w => w.OwnerId, ownerId),
                Builders<Warning>.Filter.Eq(w => w.Ticker, ticker.ToUpperInvariant())
            );

            var update = Builders<Warning>.Update
                .Set(w => w.OwnerId, ownerId)
                .Set(w => w.Ticker, ticker.ToUpperInvariant())
                .Set(w => w.RegularShareVolume, regularShareVolume)
                .Set(w => w.UpdatedAt, DateTime.UtcNow)
                .SetOnInsert(w => w.CreatedAt, DateTime.UtcNow);

            await _warnings.UpdateOneAsync(filter, update, new UpdateOptions { IsUpsert = true });
        }

        public async Task<Warning?> GetWarningAsync(string ownerId, string ticker)
        {
            return await _warnings
                .Find(w => w.OwnerId == ownerId && w.Ticker == ticker.ToUpperInvariant())
                .FirstOrDefaultAsync();
        }

        public async Task<List<Warning>> GetAllWarningsForOwnerAsync(string ownerId)
        {
            return await _warnings
                .Find(w => w.OwnerId == ownerId)
                .ToListAsync();
        }

        public async Task DeleteWarningAsync(string ownerId, string ticker)
        {
            await _warnings.DeleteOneAsync(w => 
                w.OwnerId == ownerId && w.Ticker == ticker.ToUpperInvariant());
        }
    }
}

