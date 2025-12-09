using System;
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
                .Find(d => d.UserId == userId && !d.Closed && !d.PlannedFuture)
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

        public async Task<decimal> CalculateInSharesRiskPercentAsync(string userId)
        {
            // Get all open deals for the user
            var openDeals = await _deals
                .Find(d => d.UserId == userId && !d.Closed && !d.PlannedFuture)
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

            // Get current In Shares value instead of Total Sum
            var inShares = await _usersService.GetInSharesAsync(userId);

            System.Diagnostics.Debug.WriteLine($"[RiskService] CalculateInSharesRiskPercentAsync - userId: {userId}, openDeals: {openDeals.Count}, totalRisk: {totalRisk}, inShares: {inShares}");

            if (inShares <= 0)
            {
                System.Diagnostics.Debug.WriteLine($"[RiskService] CalculateInSharesRiskPercentAsync - inShares is 0 or negative, returning 0");
                return 0;
            }

            // Calculate percentage: (total_risk / inShares) * 100
            decimal riskPercent = (totalRisk / inShares) * 100;
            decimal rounded = Math.Round(riskPercent, 2);

            System.Diagnostics.Debug.WriteLine($"[RiskService] CalculateInSharesRiskPercentAsync - riskPercent: {riskPercent}, rounded: {rounded}");

            return rounded;
        }

        public async Task<DealLimitResult> CalculateDealLimitsAsync(string userId, decimal stopLossPercent)
        {
            if (stopLossPercent <= 0)
                return new DealLimitResult(0, 0, 0, 0, 0, 0, false);

            // P = общий портфель (TotalSum), C = кэш (Portfolio)
            var totalSum = await _usersService.GetTotalSumAsync(userId);   // P
            var cash     = await _usersService.GetPortfolioAsync(userId);  // C

            if (totalSum <= 0 || cash <= 0)
                return new DealLimitResult(0, 0, 0, 0, 0, 0, false);

            // текущий риск портфеля, %
            var currentRiskPercent = await CalculatePortfolioRiskPercentAsync(userId);

            const decimal maxPortfolioRiskPercent   = 5m;   // лимит суммарного риска портфеля, %
            const decimal perDealRiskPercent        = 1m;   // максимум риска на сделку, %
            const decimal perDealExposureCapPercent = 20m;  // максимум доли портфеля на сделку, %

            var sl = stopLossPercent / 100m;

            // 1) Лимит по размеру позиции (экспозиция 10–20% портфеля)
            var maxExposure = (perDealExposureCapPercent / 100m) * totalSum;

            // 2) Лимит по риску сделки (напр. 1% портфеля)
            var maxRiskAmount = (perDealRiskPercent / 100m) * totalSum;
            var maxByRisk = maxRiskAmount / sl;

            // 3) Учитываем доступный кэш
            var sMax = Math.Min(maxExposure, Math.Min(maxByRisk, cash));
            if (sMax <= 0)
                return new DealLimitResult(0, 0, 0, 0, 0, 0, false);

            // Риск от сделки размером S_max
            var addedRiskAmount   = sMax * sl;
            var addedRiskPercent  = (addedRiskAmount / totalSum) * 100m;
            var totalRiskPercent  = currentRiskPercent + addedRiskPercent;
            var allowed           = totalRiskPercent <= maxPortfolioRiskPercent;

            var maxStage1 = sMax * 0.5m;

            // Рекомендация: 35% / 65%
            var recStage1 = sMax * 0.35m;
            var recStage2 = sMax - recStage1;

            // Одноэтапная сделка: не более 0.5% риска и не больше первой половины
            var singleRiskCapPercent = perDealRiskPercent / 2m; // 0.5% если perDealRiskPercent = 1
            var singleCapByRisk      = (singleRiskCapPercent / 100m * totalSum) / sl;
            var singleStageMax       = Math.Min(singleCapByRisk, maxStage1);

            return new DealLimitResult(
                MaxPosition:        sMax,
                MaxStage1:          maxStage1,
                RecommendedStage1:  recStage1,
                RecommendedStage2:  recStage2,
                AddedRiskPercent:   addedRiskPercent,
                SingleStageMax:     singleStageMax,
                Allowed:            allowed
            );
        }
    }
}
