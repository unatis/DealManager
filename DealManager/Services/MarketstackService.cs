using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using DealManager.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class MarketstackService
    {
        private readonly HttpClient _http;
        private readonly MarketstackSettings _settings;
        private readonly ILogger<MarketstackService> _logger;
        private readonly IMongoCollection<CachedQuote> _quotesCollection;
        private readonly IMongoCollection<CachedWeeklySeries> _weeklyCollection;

        private const int PageLimit = 1000;

        public sealed record QuoteSnapshot(decimal Price, DateTime LastUpdatedUtc);

        private sealed record DailyBar(
            DateTime Date,
            decimal Open,
            decimal High,
            decimal Low,
            decimal Close,
            long Volume);

        public MarketstackService(
            HttpClient http,
            IOptions<MarketstackSettings> settings,
            ILogger<MarketstackService> logger,
            MongoSettings mongoSettings)
        {
            _http = http;
            _settings = settings.Value;
            _logger = logger;

            var clientSettings = MongoClientSettings.FromConnectionString(mongoSettings.ConnectionString);
            clientSettings.AllowInsecureTls = true;
            var client = new MongoClient(clientSettings);
            var db = client.GetDatabase(mongoSettings.Database);
            _quotesCollection = db.GetCollection<CachedQuote>(mongoSettings.QuotesCollection);
            _weeklyCollection = db.GetCollection<CachedWeeklySeries>(mongoSettings.WeeklyPricesCollection);
        }

        public async Task<IReadOnlyList<PricePoint>> GetWeeklyAsync(string symbol, int yearsBack = 2)
        {
            if (string.IsNullOrWhiteSpace(symbol))
                throw new ArgumentException("Ticker is required", nameof(symbol));

            if (yearsBack <= 0)
                throw new ArgumentException("Years back must be positive", nameof(yearsBack));

            symbol = symbol.Trim().ToUpperInvariant();

            var dateTo = DateTime.UtcNow.Date;
            var dateFrom = dateTo.AddYears(-yearsBack);

            var daily = await FetchDailyFromApi(symbol, dateFrom, dateTo);
            if (daily.Count == 0)
                throw new InvalidOperationException("Marketstack returned no daily data");

            var weekly = AggregateToWeekly(daily);
            if (weekly.Count == 0)
                throw new InvalidOperationException("No weekly data after aggregation");

            await EnsureSavedToMongoDB(symbol, weekly);
            return weekly.AsReadOnly();
        }

        public async Task<IReadOnlyList<PricePoint>> GetMonthlyAsync(string symbol, int yearsBack = 2)
        {
            if (string.IsNullOrWhiteSpace(symbol))
                throw new ArgumentException("Ticker is required", nameof(symbol));

            if (yearsBack <= 0)
                throw new ArgumentException("Years back must be positive", nameof(yearsBack));

            symbol = symbol.Trim().ToUpperInvariant();

            var dateTo = DateTime.UtcNow.Date;
            var dateFrom = dateTo.AddYears(-yearsBack);

            var daily = await FetchDailyFromApi(symbol, dateFrom, dateTo);
            if (daily.Count == 0)
                throw new InvalidOperationException("Marketstack returned no daily data");

            var monthly = AggregateToMonthly(daily);
            if (monthly.Count == 0)
                throw new InvalidOperationException("No monthly data after aggregation");

            await EnsureSavedToMongoDB(symbol, monthly);
            return monthly.AsReadOnly();
        }

        public async Task<QuoteSnapshot?> GetCurrentQuoteAsync(string symbol)
        {
            if (string.IsNullOrWhiteSpace(symbol))
                throw new ArgumentException("Ticker is required", nameof(symbol));

            symbol = symbol.Trim().ToUpperInvariant();

            var bar = await FetchLatestEodAsync(symbol);
            if (bar == null)
                return null;

            var nowUtc = DateTime.UtcNow;
            await UpsertQuoteAsync(symbol, bar, nowUtc);

            return new QuoteSnapshot(bar.Close, nowUtc);
        }

        private async Task<List<DailyBar>> FetchDailyFromApi(string symbol, DateTime dateFrom, DateTime dateTo)
        {
            if (string.IsNullOrWhiteSpace(_settings.ApiKey))
                throw new InvalidOperationException("Marketstack ApiKey is not configured");

            var baseUrl = (_settings.BaseUrl ?? string.Empty).TrimEnd('/');
            if (string.IsNullOrWhiteSpace(baseUrl))
                throw new InvalidOperationException("Marketstack BaseUrl is not configured");

            var daily = new List<DailyBar>();
            var offset = 0;

            while (true)
            {
                var url =
                    $"{baseUrl}/eod" +
                    $"?access_key={Uri.EscapeDataString(_settings.ApiKey)}" +
                    $"&symbols={Uri.EscapeDataString(symbol)}" +
                    $"&date_from={dateFrom:yyyy-MM-dd}" +
                    $"&date_to={dateTo:yyyy-MM-dd}" +
                    $"&sort=ASC" +
                    $"&limit={PageLimit}" +
                    $"&offset={offset}";

                using var resp = await _http.GetAsync(url);
                var json = await resp.Content.ReadAsStringAsync();

                if (string.IsNullOrWhiteSpace(json))
                    throw new InvalidOperationException("Marketstack returned empty response");

                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                if (root.TryGetProperty("error", out var errorProp))
                {
                    var message = errorProp.TryGetProperty("message", out var msgProp)
                        ? msgProp.GetString()
                        : errorProp.ToString();
                    throw new InvalidOperationException("Marketstack error: " + message);
                }

                if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
                    throw new InvalidOperationException("Marketstack response has no 'data' array");

                var countThisPage = 0;
                foreach (var item in data.EnumerateArray())
                {
                    if (!TryParseDailyBar(item, out var bar))
                        continue;

                    daily.Add(bar);
                    countThisPage++;
                }

                if (data.GetArrayLength() < PageLimit || countThisPage == 0)
                    break;

                offset += PageLimit;
            }

            return daily;
        }

        private async Task<DailyBar?> FetchLatestEodAsync(string symbol)
        {
            if (string.IsNullOrWhiteSpace(_settings.ApiKey))
                throw new InvalidOperationException("Marketstack ApiKey is not configured");

            var baseUrl = (_settings.BaseUrl ?? string.Empty).TrimEnd('/');
            if (string.IsNullOrWhiteSpace(baseUrl))
                throw new InvalidOperationException("Marketstack BaseUrl is not configured");

            var url =
                $"{baseUrl}/eod/latest" +
                $"?access_key={Uri.EscapeDataString(_settings.ApiKey)}" +
                $"&symbols={Uri.EscapeDataString(symbol)}";

            using var resp = await _http.GetAsync(url);
            var json = await resp.Content.ReadAsStringAsync();

            if (string.IsNullOrWhiteSpace(json))
                throw new InvalidOperationException("Marketstack returned empty response");

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (root.TryGetProperty("error", out var errorProp))
            {
                var message = errorProp.TryGetProperty("message", out var msgProp)
                    ? msgProp.GetString()
                    : errorProp.ToString();
                throw new InvalidOperationException("Marketstack error: " + message);
            }

            if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
                throw new InvalidOperationException("Marketstack response has no 'data' array");

            var first = data.EnumerateArray().FirstOrDefault();
            if (first.ValueKind == JsonValueKind.Undefined)
                return null;

            return TryParseDailyBar(first, out var bar) ? bar : null;
        }

        private static bool TryParseDailyBar(JsonElement item, out DailyBar bar)
        {
            bar = default;

            if (!item.TryGetProperty("date", out var dateProp))
                return false;

            var dateStr = dateProp.GetString();
            if (string.IsNullOrWhiteSpace(dateStr))
                return false;

            if (!DateTimeOffset.TryParse(dateStr, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
                return false;

            if (!TryGetDecimal(item, "open", out var open))
                return false;
            if (!TryGetDecimal(item, "high", out var high))
                return false;
            if (!TryGetDecimal(item, "low", out var low))
                return false;
            if (!TryGetDecimal(item, "close", out var close))
                return false;

            long volume = 0;
            if (item.TryGetProperty("volume", out var volProp) && volProp.ValueKind == JsonValueKind.Number)
            {
                if (volProp.TryGetInt64(out var v))
                    volume = v;
            }

            bar = new DailyBar(dto.UtcDateTime.Date, open, high, low, close, volume);
            return true;
        }

        private static bool TryGetDecimal(JsonElement item, string name, out decimal value)
        {
            value = 0;
            if (!item.TryGetProperty(name, out var prop))
                return false;
            if (prop.ValueKind != JsonValueKind.Number)
                return false;
            return prop.TryGetDecimal(out value);
        }

        private static (int Year, int Week) GetIsoWeekKey(DateTime date)
        {
            if (date.Kind == DateTimeKind.Unspecified)
                date = DateTime.SpecifyKind(date, DateTimeKind.Utc);
            else
                date = date.ToUniversalTime();

            return (ISOWeek.GetYear(date), ISOWeek.GetWeekOfYear(date));
        }

        private static List<PricePoint> AggregateToWeekly(List<DailyBar> daily)
        {
            var ordered = daily.OrderBy(d => d.Date).ToList();

            var weekly = new List<PricePoint>();
            var groups = ordered
                .GroupBy(d => GetIsoWeekKey(d.Date))
                .OrderBy(g => g.Key.Year)
                .ThenBy(g => g.Key.Week);

            foreach (var g in groups)
            {
                var weekBars = g.OrderBy(x => x.Date).ToList();
                if (weekBars.Count == 0)
                    continue;

                var first = weekBars[0];
                var last = weekBars[^1];

                weekly.Add(new PricePoint
                {
                    Date = last.Date,
                    Open = first.Open,
                    High = weekBars.Max(x => x.High),
                    Low = weekBars.Min(x => x.Low),
                    Close = last.Close,
                    Volume = weekBars.Sum(x => x.Volume)
                });
            }

            return weekly;
        }

        private static (int Year, int Month) GetMonthKey(DateTime date)
        {
            if (date.Kind == DateTimeKind.Unspecified)
                date = DateTime.SpecifyKind(date, DateTimeKind.Utc);
            else
                date = date.ToUniversalTime();

            return (date.Year, date.Month);
        }

        private static List<PricePoint> AggregateToMonthly(List<DailyBar> daily)
        {
            var ordered = daily.OrderBy(d => d.Date).ToList();

            var monthly = new List<PricePoint>();
            var groups = ordered
                .GroupBy(d => GetMonthKey(d.Date))
                .OrderBy(g => g.Key.Year)
                .ThenBy(g => g.Key.Month);

            foreach (var g in groups)
            {
                var monthBars = g.OrderBy(x => x.Date).ToList();
                if (monthBars.Count == 0)
                    continue;

                var first = monthBars[0];
                var last = monthBars[^1];

                monthly.Add(new PricePoint
                {
                    Date = last.Date,
                    Open = first.Open,
                    High = monthBars.Max(x => x.High),
                    Low = monthBars.Min(x => x.Low),
                    Close = last.Close,
                    Volume = monthBars.Sum(x => x.Volume)
                });
            }

            return monthly;
        }

        private async Task EnsureSavedToMongoDB(string symbol, IReadOnlyList<PricePoint> points)
        {
            if (points == null || points.Count == 0)
                return;

            try
            {
                var existing = await _weeklyCollection
                    .Find(x => x.Ticker == symbol)
                    .FirstOrDefaultAsync();

                if (existing != null && string.IsNullOrEmpty(existing.Id))
                {
                    await _weeklyCollection.DeleteOneAsync(x => x.Ticker == symbol);
                }

                var pointsList = points.ToList();

                var filter = Builders<CachedWeeklySeries>.Filter.Eq(x => x.Ticker, symbol);
                var update = Builders<CachedWeeklySeries>.Update
                    .Set(x => x.Ticker, symbol)
                    .Set(x => x.Points, pointsList)
                    .Set(x => x.LastUpdatedUtc, DateTime.UtcNow);

                await _weeklyCollection.UpdateOneAsync(
                    filter,
                    update,
                    new UpdateOptions { IsUpsert = true });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to save weekly prices to MongoDB for {Symbol}. Error: {Message}", symbol, ex.Message);
            }
        }

        private async Task UpsertQuoteAsync(string symbol, DailyBar bar, DateTime nowUtc)
        {
            try
            {
                CachedQuote? existingQuote = null;
                try
                {
                    existingQuote = await _quotesCollection
                        .Find(x => x.Ticker == symbol)
                        .FirstOrDefaultAsync();

                    if (existingQuote != null && string.IsNullOrEmpty(existingQuote.Id))
                    {
                        await _quotesCollection.DeleteOneAsync(x => x.Ticker == symbol);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to find existing quote for {Symbol} before save, will attempt upsert anyway", symbol);
                }

                var filter = Builders<CachedQuote>.Filter.Eq(x => x.Ticker, symbol);
                var updateBuilder = Builders<CachedQuote>.Update
                    .Set(x => x.Ticker, symbol)
                    .Set(x => x.Price, bar.Close)
                    .Set(x => x.Open, bar.Open)
                    .Set(x => x.High, bar.High)
                    .Set(x => x.Low, bar.Low)
                    .Set(x => x.Volume, bar.Volume)
                    .Set(x => x.LatestTradingDay, bar.Date)
                    .Set(x => x.LastUpdatedUtc, nowUtc);

                await _quotesCollection.UpdateOneAsync(
                    filter,
                    updateBuilder,
                    new UpdateOptions { IsUpsert = true });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to save quote to MongoDB for {Symbol}. Error: {Message}", symbol, ex.Message);
            }
        }
    }
}
