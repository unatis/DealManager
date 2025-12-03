using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using DealManager.Models;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Driver;

namespace DealManager.Services
{
    public class AlphaVantageService
    {
        private readonly HttpClient _http;
        private readonly AlphaVantageSettings _settings;
        private readonly IMemoryCache _cache;
        private readonly ILogger<AlphaVantageService> _logger;
        private readonly IMongoCollection<CachedQuote> _quotesCollection;
        private readonly IMongoCollection<CachedWeeklySeries> _weeklyCollection;

        private const string Function = "TIME_SERIES_WEEKLY";  // бесплатный endpoint

        public AlphaVantageService(
            HttpClient http,
            IOptions<AlphaVantageSettings> settings,
            IMemoryCache cache,
            ILogger<AlphaVantageService> logger,
            MongoSettings mongoSettings)
        {
            _http = http;
            _settings = settings.Value;
            _cache = cache;
            _logger = logger;

            var client = new MongoClient(mongoSettings.ConnectionString);
            var db = client.GetDatabase(mongoSettings.Database);
            _quotesCollection = db.GetCollection<CachedQuote>(mongoSettings.QuotesCollection);
            _weeklyCollection = db.GetCollection<CachedWeeklySeries>(mongoSettings.WeeklyPricesCollection);
        }

        public async Task<IReadOnlyList<PricePoint>> GetWeeklyAsync(string symbol)
        {
            if (string.IsNullOrWhiteSpace(symbol))
                throw new ArgumentException("Ticker is required", nameof(symbol));

            symbol = symbol.Trim().ToUpperInvariant();

            var cacheKey = $"av_weekly_{symbol}";
            if (_cache.TryGetValue(cacheKey, out IReadOnlyList<PricePoint>? cached) && cached != null)
                return cached;

            CachedWeeklySeries? cachedFromDb = null;
            try
            {
                cachedFromDb = await _weeklyCollection
                    .Find(x => x.Ticker == symbol)
                    .FirstOrDefaultAsync();
            }
            catch (Exception ex)
            {
                // Если в коллекции старый/несовместимый формат – просто логируем и игнорируем кэш в БД
                _logger.LogError(ex, "Failed to read cached weekly prices for {Symbol} from MongoDB", symbol);
            }

            if (cachedFromDb != null &&
                cachedFromDb.Points != null &&
                cachedFromDb.Points.Count > 0 &&
                IsSameDay(cachedFromDb.LastUpdatedUtc))
            {
                var fresh = cachedFromDb.Points
                    .OrderBy(p => p.Date)
                    .ToList()
                    .AsReadOnly();

                _cache.Set(cacheKey, fresh, TimeSpan.FromMinutes(5));
                return fresh;
            }

            var list = await FetchWeeklyFromApi(symbol);

            var entity = new CachedWeeklySeries
            {
                Ticker = symbol,
                Points = list,
                LastUpdatedUtc = DateTime.UtcNow
            };

            await _weeklyCollection.ReplaceOneAsync(
                x => x.Ticker == symbol,
                entity,
                new ReplaceOptions { IsUpsert = true });

            var readonlyList = list.AsReadOnly();
            _cache.Set(cacheKey, readonlyList, TimeSpan.FromMinutes(5));
            return readonlyList;
        }

        private async Task<List<PricePoint>> FetchWeeklyFromApi(string symbol)
        {
            var url =
                $"https://www.alphavantage.co/query?function={Function}" +
                $"&symbol={Uri.EscapeDataString(symbol)}" +
                $"&apikey={_settings.ApiKey}" +
                $"&outputsize=compact";

            using var resp = await _http.GetAsync(url);
            var json = await resp.Content.ReadAsStringAsync();

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (root.TryGetProperty("Error Message", out var errProp))
                throw new InvalidOperationException("Alpha Vantage error: " + errProp.GetString());

            if (root.TryGetProperty("Information", out var infoProp))
                throw new InvalidOperationException("Alpha Vantage info: " + infoProp.GetString());

            if (!root.TryGetProperty("Weekly Time Series", out var series))
                throw new InvalidOperationException("Alpha Vantage response has no 'Weekly Time Series'");

            var list = new List<PricePoint>();

            foreach (var obj in series.EnumerateObject())
            {
                if (!DateTime.TryParse(obj.Name, out var date))
                    continue;

                var p = obj.Value;
                var open = decimal.Parse(p.GetProperty("1. open").GetString()!);
                var high = decimal.Parse(p.GetProperty("2. high").GetString()!);
                var low = decimal.Parse(p.GetProperty("3. low").GetString()!);
                var close = decimal.Parse(p.GetProperty("4. close").GetString()!);
                var vol = long.Parse(p.GetProperty("5. volume").GetString()!);

                list.Add(new PricePoint
                {
                    Date = date,
                    Open = open,
                    High = high,
                    Low = low,
                    Close = close,
                    Volume = vol
                });
            }

            // по возрастанию даты
            list.Sort((a, b) => a.Date.CompareTo(b.Date));

            return list;
        }

        public async Task<decimal?> GetCurrentPriceAsync(string symbol)
        {
            if (string.IsNullOrWhiteSpace(symbol))
                throw new ArgumentException("Ticker is required", nameof(symbol));

            symbol = symbol.Trim().ToUpperInvariant();

            var cacheKey = $"av_quote_{symbol}";
            if (_cache.TryGetValue(cacheKey, out decimal? cached) && cached.HasValue)
                return cached;

            var cachedFromDb = await _quotesCollection
                .Find(x => x.Ticker == symbol)
                .FirstOrDefaultAsync();

            if (cachedFromDb != null && IsSameDay(cachedFromDb.LastUpdatedUtc))
            {
                _cache.Set(cacheKey, cachedFromDb.Price, TimeSpan.FromMinutes(1));
                return cachedFromDb.Price;
            }

            var url =
                $"https://www.alphavantage.co/query?function=GLOBAL_QUOTE" +
                $"&symbol={Uri.EscapeDataString(symbol)}" +
                $"&apikey={_settings.ApiKey}";

            using var resp = await _http.GetAsync(url);
            var json = await resp.Content.ReadAsStringAsync();

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (root.TryGetProperty("Error Message", out var errProp))
                throw new InvalidOperationException("Alpha Vantage error: " + errProp.GetString());

            if (root.TryGetProperty("Information", out var infoProp))
                throw new InvalidOperationException("Alpha Vantage info: " + infoProp.GetString());

            if (!root.TryGetProperty("Global Quote", out var quote))
                throw new InvalidOperationException("Alpha Vantage response has no 'Global Quote'");

            // Alpha Vantage GLOBAL_QUOTE fields:
            // 01. symbol, 02. open, 03. high, 04. low, 05. price,
            // 06. volume, 07. latest trading day, 08. previous close,
            // 09. change, 10. change percent
            decimal? ParseDecimal(string name)
            {
                return quote.TryGetProperty(name, out var prop) &&
                       decimal.TryParse(prop.GetString(), out var value)
                    ? value
                    : null;
            }

            var price = ParseDecimal("05. price");
            if (price == null)
                throw new InvalidOperationException("Alpha Vantage quote has no valid '05. price'");

            var open = ParseDecimal("02. open");
            var high = ParseDecimal("03. high");
            var low = ParseDecimal("04. low");
            var previousClose = ParseDecimal("08. previous close");
            var volume = quote.TryGetProperty("06. volume", out var volProp) &&
                         long.TryParse(volProp.GetString(), out var volVal)
                ? volVal
                : (long?)null;

            DateTime? latestTradingDay = null;
            if (quote.TryGetProperty("07. latest trading day", out var ltdProp) &&
                DateTime.TryParse(ltdProp.GetString(), out var ltdVal))
            {
                latestTradingDay = ltdVal;
            }

            var change = ParseDecimal("09. change");
            string? changePercent = null;
            if (quote.TryGetProperty("10. change percent", out var cpProp))
            {
                changePercent = cpProp.GetString();
            }

            var entity = new CachedQuote
            {
                Ticker = symbol,
                Price = price.Value,
                Open = open,
                High = high,
                Low = low,
                PreviousClose = previousClose,
                Volume = volume,
                Change = change,
                ChangePercent = changePercent,
                LatestTradingDay = latestTradingDay,
                LastUpdatedUtc = DateTime.UtcNow
            };

            await _quotesCollection.ReplaceOneAsync(
                x => x.Ticker == symbol,
                entity,
                new ReplaceOptions { IsUpsert = true });

            _cache.Set(cacheKey, price, TimeSpan.FromMinutes(1)); // Cache for 1 minute

            return price;
        }

        private static bool IsSameDay(DateTime storedUtc) =>
            storedUtc.Date == DateTime.UtcNow.Date;
    }
}
