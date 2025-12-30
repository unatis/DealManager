using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using DealManager.Models;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class RiskService : IRiskService
    {
        private readonly IMongoCollection<Deal> _deals;
        private readonly IMongoCollection<CachedQuote> _quotes;
        private readonly UsersService _usersService;

        public RiskService(MongoSettings settings, UsersService usersService)
        {
            var clientSettings = MongoClientSettings.FromConnectionString(settings.ConnectionString);
            clientSettings.AllowInsecureTls = true;
            var client = new MongoClient(clientSettings);
            var db = client.GetDatabase(settings.Database);
            _deals = db.GetCollection<Deal>(settings.DealsCollection);
            _quotes = db.GetCollection<CachedQuote>(settings.QuotesCollection);
            _usersService = usersService;
        }

        private sealed record PortfolioRiskSnapshot(
            decimal Cash,
            decimal InSharesMtm,
            decimal TotalMtm,
            decimal TotalRiskAmount,
            int OpenDealsCount
        );

        private static decimal ParseDec(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return 0m;
            s = s.Trim();

            // Tolerate both dot and comma decimal separators.
            if (decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var v)) return v;
            if (decimal.TryParse(s, NumberStyles.Any, new CultureInfo("ru-RU"), out v)) return v;
            return 0m;
        }

        private static decimal GetShares(Deal d)
        {
            decimal sum = 0m;

            if (d.Amount_tobuy_stages != null && d.Amount_tobuy_stages.Count > 0)
            {
                foreach (var x in d.Amount_tobuy_stages)
                    sum += ParseDec(x);
                return sum;
            }

            sum += ParseDec(d.Amount_tobuy_stage_1);
            sum += ParseDec(d.Amount_tobuy_stage_2);
            return sum;
        }

        private static string NormalizeTicker(string? t) =>
            (t ?? string.Empty).Trim().ToUpperInvariant();

        private async Task<Dictionary<string, decimal>> LoadQuoteMapAsync(IEnumerable<string> tickers)
        {
            var keys = tickers
                .Select(NormalizeTicker)
                .Where(t => !string.IsNullOrEmpty(t))
                .Distinct()
                .ToList();

            var map = new Dictionary<string, decimal>();
            if (keys.Count == 0) return map;

            var filter = Builders<CachedQuote>.Filter.In(x => x.Ticker, keys);
            var quotes = await _quotes.Find(filter).ToListAsync();

            foreach (var q in quotes)
            {
                var t = NormalizeTicker(q.Ticker);
                if (string.IsNullOrEmpty(t)) continue;
                if (q.Price <= 0) continue;
                map[t] = q.Price;
            }

            return map;
        }

        private static decimal EstimateDealRiskAmount(Deal deal, decimal shares)
        {
            // Preferred: exact risk from entry to stop using absolute prices.
            var entry = ParseDec(deal.SharePrice);
            var stop = ParseDec(deal.StopLoss);
            if (shares > 0 && entry > 0 && stop > 0)
            {
                var perShareRisk = Math.Max(0m, entry - stop);
                return shares * perShareRisk;
            }

            // Fallback: total_sum * (stop_loss_prcnt / 100)
            var totalSum = ParseDec(deal.TotalSum);
            var slPct = ParseDec(deal.StopLossPercent);
            if (totalSum > 0 && slPct > 0)
            {
                return totalSum * (slPct / 100m);
            }

            return 0m;
        }

        private static decimal EstimateDealMtmValue(Deal deal, decimal shares, Dictionary<string, decimal> quoteByTicker)
        {
            if (shares <= 0) return 0m;

            var ticker = NormalizeTicker(deal.Stock);
            if (!string.IsNullOrEmpty(ticker) &&
                quoteByTicker.TryGetValue(ticker, out var px) &&
                px > 0)
            {
                return shares * px;
            }

            // Fallbacks if quote is missing.
            var entry = ParseDec(deal.SharePrice);
            if (entry > 0) return shares * entry;

            var totalSum = ParseDec(deal.TotalSum);
            if (totalSum > 0) return totalSum;

            return 0m;
        }

        private async Task<PortfolioRiskSnapshot> GetPortfolioRiskSnapshotAsync(string userId)
        {
            // Open, active deals only (planned_future does not affect portfolio).
            var openDeals = await _deals
                .Find(d => d.UserId == userId && !d.Closed && !d.PlannedFuture)
                .ToListAsync();

            if (openDeals == null || openDeals.Count == 0)
            {
                var cashOnly = await _usersService.GetPortfolioAsync(userId);
                var totalFallback = await _usersService.GetTotalSumAsync(userId);
                var total = totalFallback > 0 ? totalFallback : cashOnly;
                return new PortfolioRiskSnapshot(
                    Cash: cashOnly,
                    InSharesMtm: 0m,
                    TotalMtm: total,
                    TotalRiskAmount: 0m,
                    OpenDealsCount: 0
                );
            }

            var cash = await _usersService.GetPortfolioAsync(userId);

            var quoteByTicker = await LoadQuoteMapAsync(openDeals.Select(d => d.Stock));

            decimal totalRiskAmount = 0m;
            decimal inSharesMtm = 0m;

            foreach (var deal in openDeals)
            {
                var shares = GetShares(deal);
                totalRiskAmount += EstimateDealRiskAmount(deal, shares);
                inSharesMtm += EstimateDealMtmValue(deal, shares, quoteByTicker);
            }

            var totalMtm = cash + inSharesMtm;
            if (totalMtm <= 0)
            {
                // last resort: use stored totalSum
                totalMtm = await _usersService.GetTotalSumAsync(userId);
            }

            return new PortfolioRiskSnapshot(
                Cash: cash,
                InSharesMtm: inSharesMtm,
                TotalMtm: totalMtm,
                TotalRiskAmount: totalRiskAmount,
                OpenDealsCount: openDeals.Count
            );
        }

        public async Task<decimal> CalculatePortfolioRiskPercentAsync(string userId)
        {
            var snap = await GetPortfolioRiskSnapshotAsync(userId);
            if (snap.TotalMtm <= 0 || snap.TotalRiskAmount <= 0) return 0;

            var riskPercent = (snap.TotalRiskAmount / snap.TotalMtm) * 100m;
            return Math.Round(riskPercent, 2);
        }

        public async Task<decimal> CalculateInSharesRiskPercentAsync(string userId)
        {
            var snap = await GetPortfolioRiskSnapshotAsync(userId);
            if (snap.InSharesMtm <= 0 || snap.TotalRiskAmount <= 0) return 0;

            var riskPercent = (snap.TotalRiskAmount / snap.InSharesMtm) * 100m;
            return Math.Round(riskPercent, 2);
        }

        public async Task<DealLimitResult> CalculateDealLimitsAsync(string userId, decimal stopLossPercent)
        {
            if (stopLossPercent <= 0)
                return new DealLimitResult(0, 0, 0, 0, 0, 0, false);

            // P = общий портфель (MTM: Cash + Σ(shares * currentPrice)), C = кэш (Portfolio)
            var snap = await GetPortfolioRiskSnapshotAsync(userId);
            var totalSum = snap.TotalMtm;
            var cash = snap.Cash;

            if (totalSum <= 0 || cash <= 0)
                return new DealLimitResult(0, 0, 0, 0, 0, 0, false);

            // текущий риск портфеля, % (уже MTM)
            var currentRiskPercent = snap.TotalRiskAmount > 0
                ? Math.Round((snap.TotalRiskAmount / totalSum) * 100m, 2)
                : 0m;

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
