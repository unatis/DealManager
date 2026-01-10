using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using DealManager.Models;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class RiskService : IRiskService
    {
        private readonly IMongoCollection<Deal> _deals;
        private readonly IMongoCollection<CachedQuote> _quotes;
        private readonly UsersService _usersService;
        private readonly ILogger<RiskService> _logger;

        private static bool IsRiskLogEnabled =>
            string.Equals(Environment.GetEnvironmentVariable("RISK_LOG"), "1", StringComparison.OrdinalIgnoreCase);

        public RiskService(MongoSettings settings, UsersService usersService, ILogger<RiskService> logger)
        {
            var clientSettings = MongoClientSettings.FromConnectionString(settings.ConnectionString);
            clientSettings.AllowInsecureTls = true;
            var client = new MongoClient(clientSettings);
            var db = client.GetDatabase(settings.Database);
            _deals = db.GetCollection<Deal>(settings.DealsCollection);
            _quotes = db.GetCollection<CachedQuote>(settings.QuotesCollection);
            _usersService = usersService;
            _logger = logger;
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

        private static decimal? TryGetAvgEntryFromStages(Deal deal)
        {
            // Weighted average entry:
            // avg = sum(shares_i * buyPrice_i) / sum(shares_i)
            //
            // NOTE: We require buy_price_stages to be aligned with amount_tobuy_stages.
            // If not present/invalid, return null (caller will fall back to SharePrice).

            if (deal.Amount_tobuy_stages == null || deal.Amount_tobuy_stages.Count == 0) return null;
            if (deal.BuyPriceStages == null || deal.BuyPriceStages.Count == 0) return null;
            if (deal.BuyPriceStages.Count != deal.Amount_tobuy_stages.Count) return null;

            decimal totalShares = 0m;
            decimal totalCost = 0m;

            for (var i = 0; i < deal.Amount_tobuy_stages.Count; i++)
            {
                var sh = ParseDec(deal.Amount_tobuy_stages[i]);
                if (sh <= 0) continue;

                var px = ParseDec(deal.BuyPriceStages[i]);
                if (px <= 0) return null; // missing or invalid stage price -> cannot compute avg reliably

                totalShares += sh;
                totalCost += sh * px;
            }

            if (totalShares <= 0) return null;
            var avg = totalCost / totalShares;
            return avg > 0 ? avg : null;
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
            var avgEntry = TryGetAvgEntryFromStages(deal);
            var entry = avgEntry ?? ParseDec(deal.SharePrice);
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

            if (IsRiskLogEnabled && _logger.IsEnabled(LogLevel.Information))
            {
                _logger.LogInformation(
                    "[RISK_LOG] userId={UserId} openDeals={OpenDealsCount} cash={Cash} quotesLoaded={QuotesCount}",
                    userId,
                    openDeals.Count,
                    cash,
                    quoteByTicker.Count
                );
            }

            foreach (var deal in openDeals)
            {
                var shares = GetShares(deal);
                var riskAmount = EstimateDealRiskAmount(deal, shares);
                var mtmValue = EstimateDealMtmValue(deal, shares, quoteByTicker);

                totalRiskAmount += riskAmount;
                inSharesMtm += mtmValue;

                if (IsRiskLogEnabled && _logger.IsEnabled(LogLevel.Information))
                {
                    var ticker = NormalizeTicker(deal.Stock);
                    var avgEntry = TryGetAvgEntryFromStages(deal);
                    var entry = avgEntry ?? ParseDec(deal.SharePrice);
                    var stop = ParseDec(deal.StopLoss);
                    var totalSum = ParseDec(deal.TotalSum);
                    quoteByTicker.TryGetValue(ticker, out var quotePx);

                    // Best-effort: explain which price source was used for MTM.
                    string mtmPxSource;
                    decimal mtmPxUsed = 0m;
                    if (shares <= 0)
                    {
                        mtmPxSource = "none";
                    }
                    else if (quotePx > 0)
                    {
                        mtmPxSource = "quote";
                        mtmPxUsed = quotePx;
                    }
                    else if (entry > 0)
                    {
                        mtmPxSource = "entry";
                        mtmPxUsed = entry;
                    }
                    else if (totalSum > 0)
                    {
                        mtmPxSource = "total_sum";
                        mtmPxUsed = shares > 0 ? (totalSum / shares) : 0m;
                    }
                    else
                    {
                        mtmPxSource = "none";
                    }

                    _logger.LogInformation(
                        "[RISK_LOG] {Ticker} shares={Shares} avgEntry={AvgEntry} entryUsed={EntryUsed} stop={Stop} perShareRisk={PerShareRisk} riskAmount={RiskAmount} totalSum={TotalSum} slPct={StopLossPct} quote={Quote} mtmPxUsed={MtmPxUsed} mtmSource={MtmSource} mtmValue={MtmValue}",
                        ticker,
                        shares,
                        avgEntry,
                        entry,
                        stop,
                        (shares > 0 && entry > 0 && stop > 0) ? Math.Max(0m, entry - stop) : 0m,
                        riskAmount,
                        totalSum,
                        ParseDec(deal.StopLossPercent),
                        quotePx,
                        mtmPxUsed,
                        mtmPxSource,
                        mtmValue
                    );
                }
            }

            var totalMtm = cash + inSharesMtm;
            if (totalMtm <= 0)
            {
                // last resort: use stored totalSum
                totalMtm = await _usersService.GetTotalSumAsync(userId);
            }

            if (IsRiskLogEnabled && _logger.IsEnabled(LogLevel.Information))
            {
                var riskPct = totalMtm > 0 ? Math.Round((totalRiskAmount / totalMtm) * 100m, 4) : 0m;
                _logger.LogInformation(
                    "[RISK_LOG] TOTAL userId={UserId} cash={Cash} inSharesMtm={InSharesMtm} totalMtm={TotalMtm} totalRiskAmount={TotalRiskAmount} riskPct={RiskPct}",
                    userId,
                    cash,
                    inSharesMtm,
                    totalMtm,
                    totalRiskAmount,
                    riskPct
                );
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
