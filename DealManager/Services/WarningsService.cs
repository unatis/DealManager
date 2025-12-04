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

        public async Task UpsertWarningAsync(string ownerId, string ticker, bool? regularShareVolume = null, bool? sp500Member = null, bool? atrHighRisk = null, bool? syncSp500No = null, bool? betaVolatilityHigh = null, string? stockId = null)
        {
            // If stockId is provided, use it for unique identification; otherwise fall back to ticker
            var filterBuilder = Builders<Warning>.Filter.And(
                Builders<Warning>.Filter.Eq(w => w.OwnerId, ownerId)
            );

            if (!string.IsNullOrWhiteSpace(stockId))
            {
                // Use StockId for unique identification (allows multiple stocks with same ticker)
                filterBuilder = Builders<Warning>.Filter.And(
                    Builders<Warning>.Filter.Eq(w => w.OwnerId, ownerId),
                    Builders<Warning>.Filter.Eq(w => w.StockId, stockId)
                );
            }
            else
            {
                // Fallback to ticker (for backward compatibility)
                filterBuilder = Builders<Warning>.Filter.And(
                    Builders<Warning>.Filter.Eq(w => w.OwnerId, ownerId),
                    Builders<Warning>.Filter.Eq(w => w.Ticker, ticker.ToUpperInvariant())
                );
            }

            var update = Builders<Warning>.Update
                .Set(w => w.OwnerId, ownerId)
                .Set(w => w.Ticker, ticker.ToUpperInvariant())
                .Set(w => w.UpdatedAt, DateTime.UtcNow)
                .SetOnInsert(w => w.CreatedAt, DateTime.UtcNow);

            // Set StockId if provided
            if (!string.IsNullOrWhiteSpace(stockId))
            {
                update = update.Set(w => w.StockId, stockId);
            }

            var filter = filterBuilder;

            // Only update fields that are provided (not null)
            if (regularShareVolume.HasValue)
            {
                update = update.Set(w => w.RegularShareVolume, regularShareVolume.Value);
            }

            if (sp500Member.HasValue)
            {
                update = update.Set(w => w.Sp500Member, sp500Member.Value);
            }

            if (atrHighRisk.HasValue)
            {
                update = update.Set(w => w.AtrHighRisk, atrHighRisk.Value);
            }

            if (syncSp500No.HasValue)
            {
                update = update.Set(w => w.SyncSp500No, syncSp500No.Value);
            }

            if (betaVolatilityHigh.HasValue)
            {
                update = update.Set(w => w.BetaVolatilityHigh, betaVolatilityHigh.Value);
            }

            await _warnings.UpdateOneAsync(filter, update, new UpdateOptions { IsUpsert = true });
        }

        public async Task<Warning?> GetWarningAsync(string ownerId, string ticker, string? stockId = null)
        {
            FilterDefinition<Warning> filter;
            
            if (!string.IsNullOrWhiteSpace(stockId))
            {
                // Find by StockId (preferred for unique stock instances)
                filter = Builders<Warning>.Filter.And(
                    Builders<Warning>.Filter.Eq(w => w.OwnerId, ownerId),
                    Builders<Warning>.Filter.Eq(w => w.StockId, stockId)
                );
            }
            else
            {
                // Fallback to ticker (for backward compatibility)
                filter = Builders<Warning>.Filter.And(
                    Builders<Warning>.Filter.Eq(w => w.OwnerId, ownerId),
                    Builders<Warning>.Filter.Eq(w => w.Ticker, ticker.ToUpperInvariant())
                );
            }
            
            return await _warnings.Find(filter).FirstOrDefaultAsync();
        }

        public async Task<List<Warning>> GetAllWarningsForOwnerAsync(string ownerId)
        {
            return await _warnings
                .Find(w => w.OwnerId == ownerId)
                .ToListAsync();
        }

        public async Task DeleteWarningAsync(string ownerId, string ticker, string? stockId = null)
        {
            FilterDefinition<Warning> filter;
            
            if (!string.IsNullOrWhiteSpace(stockId))
            {
                // Delete by StockId (preferred for unique stock instances)
                filter = Builders<Warning>.Filter.And(
                    Builders<Warning>.Filter.Eq(w => w.OwnerId, ownerId),
                    Builders<Warning>.Filter.Eq(w => w.StockId, stockId)
                );
            }
            else
            {
                // Fallback to ticker (for backward compatibility)
                filter = Builders<Warning>.Filter.And(
                    Builders<Warning>.Filter.Eq(w => w.OwnerId, ownerId),
                    Builders<Warning>.Filter.Eq(w => w.Ticker, ticker.ToUpperInvariant())
                );
            }
            
            await _warnings.DeleteOneAsync(filter);
        }
    }
}

