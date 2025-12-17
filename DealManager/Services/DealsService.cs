using System;
using DealManager.Models;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class DealsService
    {
        private readonly IMongoCollection<Deal> _deals;
        private readonly IRiskService _riskService;

        public DealsService(IRiskService riskService, MongoSettings settings)
        {
            var client = new MongoClient(settings.ConnectionString);
            var db = client.GetDatabase(settings.Database);
            _deals = db.GetCollection<Deal>(settings.DealsCollection);
            _riskService = riskService;
        }
        public Task<List<Deal>> GetAllForOwnerAsync(string ownerId) =>
            _deals.Find(d => d.OwnerId == ownerId).ToListAsync();

        // все сделки конкретного пользователя
        public Task<List<Deal>> GetByUserAsync(string userId) =>
            _deals.Find(d => d.UserId == userId).ToListAsync();

        // одна сделка по id + userId
        public async Task<Deal?> GetAsync(string id, string userId) =>
            await _deals.Find(d => d.Id == id && d.UserId == userId)
                        .FirstOrDefaultAsync();

        public async Task<int> GetWeeklyActivationsCountAsync(string userId)
        {
            // Count deals that were activated during the current ISO-like week (UTC, Monday-based).
            var today = DateTime.UtcNow.Date;
            var dayOfWeek = (int)today.DayOfWeek; // Sunday=0
            var delta = dayOfWeek == 0 ? 6 : dayOfWeek - 1;
            var startOfWeek = today.AddDays(-delta);

            var filter =
                Builders<Deal>.Filter.Eq(d => d.UserId, userId) &
                Builders<Deal>.Filter.Ne(d => d.ActivatedAt, null) &
                Builders<Deal>.Filter.Gte(d => d.ActivatedAt, startOfWeek);

            var count = await _deals.CountDocumentsAsync(filter);
            return (int)count;
        }

        public static double? CalculateRewardToRisk(double entry, double stopLoss, double takeProfit)
        {
            var risk = entry - stopLoss;
            var reward = takeProfit - entry;

            if (risk <= 0 || reward <= 0)
                return null;

            return reward / risk;
        }

        public Task CreateAsync(Deal deal) =>
            _deals.InsertOneAsync(deal);

        // возвращаем bool чтобы контроллер мог понять, было ли изменение
        public async Task<bool> UpdateAsync(string id, string userId, Deal deal)
        {
            deal.Id = id;
            deal.UserId = userId;

            var result = await _deals.ReplaceOneAsync(
                d => d.Id == id && d.UserId == userId,
                deal);

            return result.ModifiedCount == 1;
        }

        public async Task<bool> DeleteAsync(string id, string userId)
        {
            var result = await _deals.DeleteOneAsync(
                d => d.Id == id && d.UserId == userId);

            return result.DeletedCount == 1;
        }
    }
}
