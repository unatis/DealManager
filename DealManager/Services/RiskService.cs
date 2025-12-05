using DealManager.Models;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class RiskService : IRiskService
    {
        private readonly IMongoCollection<Deal> _deals;
        private readonly UsersService _usersService;

        public RiskService(MongoSettings settings, UsersService usersService)
        {
            var clientSettings = MongoClientSettings.FromConnectionString(settings.ConnectionString);
            clientSettings.AllowInsecureTls = true;
            var client = new MongoClient(clientSettings);
            var db = client.GetDatabase(settings.Database);
            _deals = db.GetCollection<Deal>(settings.DealsCollection);
            _usersService = usersService;
        }

        public async Task<decimal> CalculatePortfolioRiskPercentAsync(string userId)
        {
            // Get all open deals for the user
            var openDeals = await _deals
                .Find(d => d.UserId == userId && !d.Closed)
                .ToListAsync();

            if (openDeals == null || openDeals.Count == 0)
                return 0;

            // Calculate total risk amount from all open deals
            decimal totalRisk = 0;

            foreach (var deal in openDeals)
            {
                // Parse total_sum
                if (string.IsNullOrWhiteSpace(deal.TotalSum))
                    continue;

                if (!decimal.TryParse(deal.TotalSum, out var dealTotalSum))
                    continue;

                // Parse stop_loss_prcnt
                decimal stopLossPercent = 0;
                if (!string.IsNullOrWhiteSpace(deal.StopLossPercent))
                {
                    if (!decimal.TryParse(deal.StopLossPercent, out stopLossPercent))
                        continue;
                }

                // Calculate risk for this deal: total_sum * (stop_loss_percent / 100)
                if (stopLossPercent > 0 && dealTotalSum > 0)
                {
                    decimal dealRisk = dealTotalSum * (stopLossPercent / 100);
                    totalRisk += dealRisk;
                }
            }

            // Get current Total Sum value (Cash + In Shares)
            var totalSum = await _usersService.GetTotalSumAsync(userId);

            if (totalSum <= 0)
                return 0;

            // Calculate percentage: (total_risk / totalSum) * 100
            decimal riskPercent = (totalRisk / totalSum) * 100;

            return Math.Round(riskPercent, 2);
        }
    }
}
