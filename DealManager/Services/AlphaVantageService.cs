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
using MongoDB.Bson;
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

            var clientSettings = MongoClientSettings.FromConnectionString(mongoSettings.ConnectionString);
            clientSettings.AllowInsecureTls = true;
            var client = new MongoClient(clientSettings);
            var db = client.GetDatabase(mongoSettings.Database);
            _quotesCollection = db.GetCollection<CachedQuote>(mongoSettings.QuotesCollection);
            _weeklyCollection = db.GetCollection<CachedWeeklySeries>(mongoSettings.WeeklyPricesCollection);

            // Clean up documents with null Id on startup (fire and forget)
            _ = Task.Run(async () =>
            {
                try
                {
                    await CleanupNullIdDocumentsAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to cleanup null Id documents on startup");
                }
            });
        }

        /// <summary>
        /// Removes all documents with null or empty Id from both collections.
        /// This fixes duplicate key errors caused by documents with _id: null.
        /// Uses raw BSON filter to match documents where _id is null or missing.
        /// </summary>
        private async Task CleanupNullIdDocumentsAsync()
        {
            try
            {
                // Delete documents with null _id from quotes collection using raw BSON filter
                var quotesFilter = Builders<CachedQuote>.Filter.Eq("_id", BsonNull.Value);
                var quotesResult = await _quotesCollection.DeleteManyAsync(quotesFilter);
                if (quotesResult.DeletedCount > 0)
                {
                    _logger.LogInformation("Cleaned up {Count} documents with null _id from quotes collection", quotesResult.DeletedCount);
                }

                // Delete documents with null _id from weekly_prices collection using raw BSON filter
                var weeklyFilter = Builders<CachedWeeklySeries>.Filter.Eq("_id", BsonNull.Value);
                var weeklyResult = await _weeklyCollection.DeleteManyAsync(weeklyFilter);
                if (weeklyResult.DeletedCount > 0)
                {
                    _logger.LogInformation("Cleaned up {Count} documents with null _id from weekly_prices collection", weeklyResult.DeletedCount);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during cleanup of null Id documents: {Message}", ex.Message);
            }
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

            List<PricePoint> list;
            try
            {
                list = await FetchWeeklyFromApi(symbol);
                _logger.LogInformation("Successfully fetched {Count} price points from Alpha Vantage for {Symbol}", list.Count, symbol);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to fetch weekly prices from Alpha Vantage for {Symbol}: {Message}", symbol, ex.Message);
                throw; // Re-throw to be handled by controller
            }

            // Try to save to MongoDB, but don't fail if it doesn't work
            try
            {
                // Find existing document to check if it exists
                var existing = await _weeklyCollection
                    .Find(x => x.Ticker == symbol)
                    .FirstOrDefaultAsync();

                var hadValidId = existing != null && !string.IsNullOrEmpty(existing.Id);

                // If existing document has null Id, delete it first to avoid duplicate key error
                if (existing != null && string.IsNullOrEmpty(existing.Id))
                {
                    await _weeklyCollection.DeleteOneAsync(x => x.Ticker == symbol);
                }

                // Use UpdateOneAsync with $set operator - MongoDB will auto-generate Id for new documents
                var filter = Builders<CachedWeeklySeries>.Filter.Eq(x => x.Ticker, symbol);
                var update = Builders<CachedWeeklySeries>.Update
                    .Set(x => x.Ticker, symbol)
                    .Set(x => x.Points, list)
                    .Set(x => x.LastUpdatedUtc, DateTime.UtcNow);
                
                var result = await _weeklyCollection.UpdateOneAsync(
                    filter,
                    update,
                    new UpdateOptions { IsUpsert = true });
                
                if (result.UpsertedId != null)
                {
                    _logger.LogInformation("Successfully inserted weekly prices for {Symbol} to MongoDB ({Count} points). New Id: {Id}", 
                        symbol, list.Count, result.UpsertedId);
                }
                else if (result.ModifiedCount > 0)
                {
                    _logger.LogInformation("Successfully updated weekly prices for {Symbol} in MongoDB ({Count} points). Matched: {Matched}", 
                        symbol, list.Count, result.MatchedCount);
                }
                else
                {
                    _logger.LogWarning("MongoDB update for {Symbol} returned no changes. Matched: {Matched}", 
                        symbol, result.MatchedCount);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to save weekly prices to MongoDB for {Symbol}, but continuing with in-memory cache. Error: {Message}, StackTrace: {StackTrace}", 
                    symbol, ex.Message, ex.StackTrace);
                // Continue even if DB save fails - we still have the data in memory cache
            }

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

            _logger.LogInformation("Fetching weekly prices from Alpha Vantage for {Symbol}", symbol);
            
            using var resp = await _http.GetAsync(url);
            var json = await resp.Content.ReadAsStringAsync();

            if (string.IsNullOrWhiteSpace(json))
            {
                _logger.LogError("Alpha Vantage returned empty response for {Symbol}", symbol);
                throw new InvalidOperationException("Alpha Vantage returned empty response");
            }

            _logger.LogDebug("Alpha Vantage response for {Symbol} (first 500 chars): {Response}", symbol, json.Length > 500 ? json.Substring(0, 500) : json);

            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(json);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to parse JSON response for {Symbol}. Response: {Response}", symbol, json);
                throw new InvalidOperationException($"Failed to parse Alpha Vantage response: {ex.Message}");
            }

            using (doc)
            {
                var root = doc.RootElement;

                if (root.TryGetProperty("Error Message", out var errProp))
                {
                    var errorMsg = errProp.GetString();
                    _logger.LogWarning("Alpha Vantage error message for {Symbol}: {Error}", symbol, errorMsg);
                    throw new InvalidOperationException("Alpha Vantage error: " + errorMsg);
                }

                if (root.TryGetProperty("Information", out var infoProp))
                {
                    var infoMsg = infoProp.GetString();
                    _logger.LogWarning("Alpha Vantage information message for {Symbol}: {Info}", symbol, infoMsg);
                    throw new InvalidOperationException("Alpha Vantage info: " + infoMsg);
                }

                if (!root.TryGetProperty("Weekly Time Series", out var series))
                {
                    _logger.LogError("Alpha Vantage response for {Symbol} has no 'Weekly Time Series'. Response keys: {Keys}", 
                        symbol, string.Join(", ", root.EnumerateObject().Select(p => p.Name)));
                    throw new InvalidOperationException("Alpha Vantage response has no 'Weekly Time Series'");
                }

                var list = new List<PricePoint>();

                foreach (var obj in series.EnumerateObject())
                {
                    if (!DateTime.TryParse(obj.Name, out var date))
                    {
                        _logger.LogWarning("Failed to parse date: {DateString}", obj.Name);
                        continue;
                    }

                    var p = obj.Value;
                    
                    // Safe parsing with error handling
                    if (!p.TryGetProperty("1. open", out var openProp) || 
                        !decimal.TryParse(openProp.GetString(), out var open))
                    {
                        _logger.LogWarning("Failed to parse open price for date {Date}", obj.Name);
                        continue;
                    }

                    if (!p.TryGetProperty("2. high", out var highProp) || 
                        !decimal.TryParse(highProp.GetString(), out var high))
                    {
                        _logger.LogWarning("Failed to parse high price for date {Date}", obj.Name);
                        continue;
                    }

                    if (!p.TryGetProperty("3. low", out var lowProp) || 
                        !decimal.TryParse(lowProp.GetString(), out var low))
                    {
                        _logger.LogWarning("Failed to parse low price for date {Date}", obj.Name);
                        continue;
                    }

                    if (!p.TryGetProperty("4. close", out var closeProp) || 
                        !decimal.TryParse(closeProp.GetString(), out var close))
                    {
                        _logger.LogWarning("Failed to parse close price for date {Date}", obj.Name);
                        continue;
                    }

                    if (!p.TryGetProperty("5. volume", out var volProp) || 
                        !long.TryParse(volProp.GetString(), out var vol))
                    {
                        _logger.LogWarning("Failed to parse volume for date {Date}", obj.Name);
                        continue;
                    }

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

                if (list.Count == 0)
                    throw new InvalidOperationException("No valid price points found in Alpha Vantage response");

                // по возрастанию даты
                list.Sort((a, b) => a.Date.CompareTo(b.Date));

                return list;
            }
        }

        public async Task<decimal?> GetCurrentPriceAsync(string symbol)
        {
            if (string.IsNullOrWhiteSpace(symbol))
                throw new ArgumentException("Ticker is required", nameof(symbol));

            symbol = symbol.Trim().ToUpperInvariant();

            var cacheKey = $"av_quote_{symbol}";
            if (_cache.TryGetValue(cacheKey, out decimal? cached) && cached.HasValue)
                return cached;

            CachedQuote? cachedFromDb = null;
            try
            {
                cachedFromDb = await _quotesCollection
                    .Find(x => x.Ticker == symbol)
                    .FirstOrDefaultAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to read cached quote for {Symbol} from MongoDB", symbol);
                // Continue to fetch from API if DB read fails
            }

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

            if (string.IsNullOrWhiteSpace(json))
                throw new InvalidOperationException("Alpha Vantage returned empty response");

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (root.TryGetProperty("Error Message", out var errProp))
                throw new InvalidOperationException("Alpha Vantage error: " + errProp.GetString());

            if (root.TryGetProperty("Information", out var infoProp))
                throw new InvalidOperationException("Alpha Vantage info: " + infoProp.GetString());

            if (!root.TryGetProperty("Global Quote", out var quote))
            {
                _logger.LogError("Alpha Vantage response for {Symbol} has no 'Global Quote'. Response: {Response}", symbol, json);
                throw new InvalidOperationException("Alpha Vantage response has no 'Global Quote'");
            }

            // Alpha Vantage GLOBAL_QUOTE fields:
            // 01. symbol, 02. open, 03. high, 04. low, 05. price,
            // 06. volume, 07. latest trading day, 08. previous close,
            // 09. change, 10. change percent
            decimal? ParseDecimal(string name)
            {
                if (!quote.TryGetProperty(name, out var prop))
                    return null;
                
                var strValue = prop.GetString();
                if (string.IsNullOrWhiteSpace(strValue))
                    return null;
                
                if (decimal.TryParse(strValue, out var value))
                    return value;
                
                _logger.LogWarning("Failed to parse decimal value '{Value}' for field '{Field}'", strValue, name);
                return null;
            }

            var price = ParseDecimal("05. price");
            if (price == null)
            {
                _logger.LogError("Alpha Vantage quote for {Symbol} has no valid '05. price'. Quote data: {Quote}", symbol, quote.ToString());
                throw new InvalidOperationException("Alpha Vantage quote has no valid '05. price'");
            }

            var open = ParseDecimal("02. open");
            var high = ParseDecimal("03. high");
            var low = ParseDecimal("04. low");
            var previousClose = ParseDecimal("08. previous close");
            
            long? volume = null;
            if (quote.TryGetProperty("06. volume", out var volProp))
            {
                var volStr = volProp.GetString();
                if (!string.IsNullOrWhiteSpace(volStr) && long.TryParse(volStr, out var volVal))
                {
                    volume = volVal;
                }
            }

            DateTime? latestTradingDay = null;
            if (quote.TryGetProperty("07. latest trading day", out var ltdProp))
            {
                var ltdStr = ltdProp.GetString();
                if (!string.IsNullOrWhiteSpace(ltdStr) && DateTime.TryParse(ltdStr, out var ltdVal))
                {
                    latestTradingDay = ltdVal;
                }
            }

            var change = ParseDecimal("09. change");
            string? changePercent = null;
            if (quote.TryGetProperty("10. change percent", out var cpProp))
            {
                changePercent = cpProp.GetString();
            }

            // Find existing document to check if it exists
            CachedQuote? existingQuote = null;
            bool hadValidId = false;
            try
            {
                existingQuote = await _quotesCollection
                    .Find(x => x.Ticker == symbol)
                    .FirstOrDefaultAsync();
                
                hadValidId = existingQuote != null && !string.IsNullOrEmpty(existingQuote.Id);
                
                // If existing document has null Id, delete it first to avoid duplicate key error
                if (existingQuote != null && string.IsNullOrEmpty(existingQuote.Id))
                {
                    await _quotesCollection.DeleteOneAsync(x => x.Ticker == symbol);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to find existing quote for {Symbol} before save, will attempt upsert anyway", symbol);
            }

            try
            {
                // Use UpdateOneAsync with $set operator - MongoDB will auto-generate Id for new documents
                var filter = Builders<CachedQuote>.Filter.Eq(x => x.Ticker, symbol);
                var updateBuilder = Builders<CachedQuote>.Update
                    .Set(x => x.Ticker, symbol)
                    .Set(x => x.Price, price.Value)
                    .Set(x => x.LastUpdatedUtc, DateTime.UtcNow);
                
                if (open.HasValue) updateBuilder = updateBuilder.Set(x => x.Open, open.Value);
                if (high.HasValue) updateBuilder = updateBuilder.Set(x => x.High, high.Value);
                if (low.HasValue) updateBuilder = updateBuilder.Set(x => x.Low, low.Value);
                if (previousClose.HasValue) updateBuilder = updateBuilder.Set(x => x.PreviousClose, previousClose.Value);
                if (volume.HasValue) updateBuilder = updateBuilder.Set(x => x.Volume, volume.Value);
                if (change.HasValue) updateBuilder = updateBuilder.Set(x => x.Change, change.Value);
                if (!string.IsNullOrEmpty(changePercent)) updateBuilder = updateBuilder.Set(x => x.ChangePercent, changePercent);
                if (latestTradingDay.HasValue) updateBuilder = updateBuilder.Set(x => x.LatestTradingDay, latestTradingDay.Value);
                
                var result = await _quotesCollection.UpdateOneAsync(
                    filter,
                    updateBuilder,
                    new UpdateOptions { IsUpsert = true });
                
                if (result.UpsertedId != null)
                {
                    _logger.LogInformation("Successfully inserted quote for {Symbol} to MongoDB. New Id: {Id}", 
                        symbol, result.UpsertedId);
                }
                else if (result.ModifiedCount > 0)
                {
                    _logger.LogInformation("Successfully updated quote for {Symbol} in MongoDB. Matched: {Matched}", 
                        symbol, result.MatchedCount);
                }
                else
                {
                    _logger.LogWarning("MongoDB update for quote {Symbol} returned no changes. Matched: {Matched}", 
                        symbol, result.MatchedCount);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to save quote to MongoDB for {Symbol}. Error: {Message}, StackTrace: {StackTrace}", 
                    symbol, ex.Message, ex.StackTrace);
                // Continue even if DB save fails - we still have the price
            }

            _cache.Set(cacheKey, price, TimeSpan.FromMinutes(1)); // Cache for 1 minute

            return price;
        }

        private static bool IsSameDay(DateTime storedUtc) =>
            storedUtc.Date == DateTime.UtcNow.Date;
    }
}
