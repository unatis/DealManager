using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace DealManager.Services;

public record PricePoint(
    DateTime Date,
    decimal Open,
    decimal High,
    decimal Low,
    decimal Close,
    long Volume);

public class AlphaVantageService
{
    private readonly HttpClient _http;
    private readonly AlphaVantageSettings _settings;
    private readonly IMemoryCache _cache;
    private readonly ILogger<AlphaVantageService> _logger;

    private const string Function = "TIME_SERIES_WEEKLY";  // БЕСПЛАТНЫЙ endpoint

    public AlphaVantageService(
        HttpClient http,
        IOptions<AlphaVantageSettings> settings,
        IMemoryCache cache,
        ILogger<AlphaVantageService> logger)
    {
        _http = http;
        _settings = settings.Value;
        _cache = cache;
        _logger = logger;
    }

    public async Task<IReadOnlyList<PricePoint>> GetWeeklyAsync(string symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            throw new ArgumentException("Ticker is required", nameof(symbol));

        symbol = symbol.Trim().ToUpperInvariant();

        var cacheKey = $"av_weekly_{symbol}";
        if (_cache.TryGetValue(cacheKey, out IReadOnlyList<PricePoint>? cached) && cached != null)
            return cached;

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

            list.Add(new PricePoint(date, open, high, low, close, vol));
        }

        list.Sort((a, b) => a.Date.CompareTo(b.Date)); // по возрастанию даты

        _cache.Set(cacheKey, list, TimeSpan.FromMinutes(5));

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

        if (!quote.TryGetProperty("05. price", out var priceProp))
            throw new InvalidOperationException("Alpha Vantage quote has no '05. price'");

        var priceStr = priceProp.GetString();
        if (string.IsNullOrWhiteSpace(priceStr))
            return null;

        if (!decimal.TryParse(priceStr, out var price))
            return null;

        _cache.Set(cacheKey, price, TimeSpan.FromMinutes(1)); // Cache for 1 minute

        return price;
    }
}
