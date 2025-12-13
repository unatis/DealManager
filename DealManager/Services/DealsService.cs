using DealManager.Models;
using MongoDB.Driver;
using System.Globalization;

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
        public async Task<List<Deal>> GetByUserAsync(string userId)
        {
            var list = await _deals.Find(d => d.UserId == userId).ToListAsync();
            await MigrateLegacyStagesAsync(userId, list);
            return list;
        }

        // одна сделка по id + userId
        public async Task<Deal?> GetAsync(string id, string userId)
        {
            var deal = await _deals.Find(d => d.Id == id && d.UserId == userId)
                                   .FirstOrDefaultAsync();
            if (deal != null)
            {
                await MigrateLegacyStagesAsync(userId, new List<Deal> { deal });
            }
            return deal;
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

        private static bool TryParsePositiveDecimal(string? s, out decimal value)
        {
            value = 0m;
            if (string.IsNullOrWhiteSpace(s)) return false;
            var normalized = s.Trim().Replace(',', '.');
            return decimal.TryParse(normalized, NumberStyles.Any, CultureInfo.InvariantCulture, out value) && value > 0;
        }

        private static List<string> BuildStagesFromLegacy(Deal deal)
        {
            var stages = new List<string>();
            if (TryParsePositiveDecimal(deal.Amount_tobuy_stage_1, out var s1))
                stages.Add(s1.ToString(CultureInfo.InvariantCulture));
            if (TryParsePositiveDecimal(deal.Amount_tobuy_stage_2, out var s2))
                stages.Add(s2.ToString(CultureInfo.InvariantCulture));
            return stages;
        }

        private async Task MigrateLegacyStagesAsync(string userId, List<Deal> deals)
        {
            if (deals == null || deals.Count == 0) return;

            var tasks = new List<Task>();

            foreach (var deal in deals)
            {
                var hasNew = deal.Amount_tobuy_stages != null && deal.Amount_tobuy_stages.Count > 0;
                if (hasNew) continue;

                var legacyStages = BuildStagesFromLegacy(deal);
                if (legacyStages.Count == 0) continue;

                deal.Amount_tobuy_stages = legacyStages;

                // Persist migration (and remove old fields so UI can't fall back to them)
                var update = Builders<Deal>.Update
                    .Set(d => d.Amount_tobuy_stages, legacyStages)
                    .Unset(d => d.Amount_tobuy_stage_1)
                    .Unset(d => d.Amount_tobuy_stage_2);

                tasks.Add(_deals.UpdateOneAsync(
                    d => d.Id == deal.Id && d.UserId == userId,
                    update));
            }

            if (tasks.Count > 0)
            {
                await Task.WhenAll(tasks);
            }
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
