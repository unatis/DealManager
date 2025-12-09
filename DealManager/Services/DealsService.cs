using DealManager.Models;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class DealsService
    {
        private readonly IMongoCollection<Deal> _deals;

        public DealsService(MongoSettings settings)
        {
            var client = new MongoClient(settings.ConnectionString);
            var db = client.GetDatabase(settings.Database);
            _deals = db.GetCollection<Deal>(settings.DealsCollection);
        }
        public Task<List<Deal>> GetAllForOwnerAsync(string ownerId) =>
            _deals.Find(d => d.OwnerId == ownerId).ToListAsync();

        // все сделки конкретного пользователя
        public Task<List<Deal>> GetByUserAsync(string userId) =>
            _deals.Find(d => d.UserId == userId).ToListAsync();

        // одна сделка по id + userId
        public Task<Deal?> GetAsync(string id, string userId) =>
            _deals.Find(d => d.Id == id && d.UserId == userId)
                  .FirstOrDefaultAsync();

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

        /// <summary>
        /// Количество активированных сделок за текущую календарную неделю (начало недели – понедельник).
        /// Учитываются только реальные сделки (PlannedFuture == false) с ненулевым ActivatedAt.
        /// </summary>
        public async Task<int> GetWeeklyActivationsCountAsync(string userId)
        {
            var today = DateTime.UtcNow.Date;
            // Смещаем DayOfWeek так, чтобы Monday = 0, Sunday = 6
            int delta = ((int)today.DayOfWeek + 6) % 7;
            var weekStart = today.AddDays(-delta);

            var filter = Builders<Deal>.Filter.And(
                Builders<Deal>.Filter.Eq(d => d.UserId, userId),
                Builders<Deal>.Filter.Eq(d => d.PlannedFuture, false),
                Builders<Deal>.Filter.Gte(d => d.ActivatedAt, weekStart)
            );

            var count = await _deals.CountDocumentsAsync(filter);
            return (int)count;
        }

        // Helper method to calculate Reward-to-Risk ratio
        public static double CalculateRewardToRisk(double entry, double stopLoss, double takeProfit)
        {
            double risk = entry - stopLoss;
            double reward = takeProfit - entry;

            if (risk <= 0 || reward <= 0)
                return 0; // Invalid configuration

            return reward / risk; // 3.0 -> "1 к 3"
        }
    }
}
