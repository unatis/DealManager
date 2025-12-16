using DealManager.Models;
using DealManager.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace DealManager.Controllers;

[ApiController]
[Route("api/[controller]")]
// [Authorize]  // можно вернуть, если хочешь защищать графики токеном
public class PricesController : ControllerBase
{
    private readonly AlphaVantageService _alpha;
    private readonly ILogger<PricesController> _logger;
    private readonly TrendAnalyzer _trendAnalyzer;

    public PricesController(
        AlphaVantageService alpha, 
        ILogger<PricesController> logger,
        TrendAnalyzer trendAnalyzer)
    {
        _alpha = alpha;
        _logger = logger;
        _trendAnalyzer = trendAnalyzer;
    }

    [HttpGet("{ticker}")]
    public async Task<IActionResult> Get(string ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        try
        {
            _logger.LogInformation("Fetching weekly prices for {Ticker} - this will ensure data is saved to MongoDB", ticker);
            var data = await _alpha.GetWeeklyAsync(ticker);
            _logger.LogInformation("Retrieved {Count} price points for {Ticker} - data should now be persisted in MongoDB", data.Count, ticker);
            
            if (data.Count == 0)
                return NotFound("No data for this ticker");

            return Ok(data);
        }
        catch (InvalidOperationException ex)
        {
            // читабельные ошибки от Alpha Vantage
            _logger.LogWarning(ex, "Alpha Vantage error for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load prices for {Ticker}. Exception: {ExceptionType}, Message: {Message}, StackTrace: {StackTrace}", 
                ticker, ex.GetType().Name, ex.Message, ex.StackTrace);
            return StatusCode(500, $"Internal error while loading prices: {ex.Message}");
        }
    }

    [HttpGet("{ticker}/quote")]
    public async Task<IActionResult> GetQuote(string ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        try
        {
            var price = await _alpha.GetCurrentPriceAsync(ticker);
            if (!price.HasValue)
                return NotFound("No current price available for this ticker");

            return Ok(new { price = price.Value });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Alpha Vantage error for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Invalid argument for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load quote for {Ticker}. Exception: {ExceptionType}, Message: {Message}, StackTrace: {StackTrace}", 
                ticker, ex.GetType().Name, ex.Message, ex.StackTrace);
            return StatusCode(500, $"Internal error while loading quote: {ex.Message}");
        }
    }

    [HttpGet("{ticker}/trends")]
    public async Task<IActionResult> GetTrends(string ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        try
        {
            if (_trendAnalyzer == null)
            {
                _logger.LogError("TrendAnalyzer is null for {Ticker}", ticker);
                return StatusCode(500, "TrendAnalyzer service is not available");
            }

            _logger.LogInformation("Fetching trends for {Ticker}", ticker);
            var priceData = await _alpha.GetWeeklyAsync(ticker);
            _logger.LogInformation("Retrieved {Count} price points for trends calculation for {Ticker}", priceData.Count, ticker);
            
            if (priceData.Count == 0)
                return NotFound("No data for this ticker");

            // Calculate weekly trend (last 2 weeks)
            TrendAnalyzer.TrendWeeks weeklyTrend;
            try
            {
                weeklyTrend = _trendAnalyzer.DetectTrendByLowsForWeeks(priceData, weeks: 3);
                _logger.LogInformation("Weekly trend for {Ticker}: {Trend}", ticker, weeklyTrend);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to calculate weekly trend for {Ticker}", ticker);
                weeklyTrend = TrendAnalyzer.TrendWeeks.Flat;
            }
            
            // Calculate monthly trend (last 2 months = ~8 weeks)
            TrendAnalyzer.TrendMonthes monthlyTrend;
            try
            {
                monthlyTrend = _trendAnalyzer.DetectTrendByLowsForMonths(priceData, months: 2);
                _logger.LogInformation("Monthly trend for {Ticker}: {Trend}", ticker, monthlyTrend);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to calculate monthly trend for {Ticker}", ticker);
                monthlyTrend = TrendAnalyzer.TrendMonthes.Flat;
            }

            return Ok(new
            {
                weekly = weeklyTrend.ToString(),
                monthly = monthlyTrend.ToString()
            });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Alpha Vantage error for trends {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to calculate trends for {Ticker}. Exception: {ExceptionType}, Message: {Message}, StackTrace: {StackTrace}", 
                ticker, ex.GetType().Name, ex.Message, ex.StackTrace);
            return StatusCode(500, $"Internal error while calculating trends: {ex.Message}");
        }
    }

    [HttpGet("{ticker}/support-resistance")]
    public async Task<IActionResult> GetSupportResistance(string ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        try
        {
            if (_trendAnalyzer == null)
            {
                _logger.LogError("TrendAnalyzer is null for {Ticker}", ticker);
                return StatusCode(500, "TrendAnalyzer service is not available");
            }

            _logger.LogInformation("Calculating support/resistance levels for {Ticker}", ticker);
            var priceData = await _alpha.GetWeeklyAsync(ticker);
            _logger.LogInformation("Retrieved {Count} price points for support/resistance calculation for {Ticker}", priceData.Count, ticker);
            
            if (priceData.Count == 0)
                return NotFound("No data for this ticker");

            // Log all price points for debugging
            _logger.LogInformation("Price points for {Ticker}: {PricePoints}", ticker, 
                string.Join(" | ", priceData.Select(p => $"Date:{p.Date:yyyy-MM-dd} H:{p.High} L:{p.Low}")));

            // Try with relaxed parameters first (lower minTotalTouches to find more levels)
            var levels = _trendAnalyzer.DetectSupportResistanceLevels(priceData, minHighTouches: 1, minLowTouches: 1, minTotalTouches: 4, maxLevels: 0);
            _logger.LogInformation("Found {Count} support/resistance levels for {Ticker} with minTotalTouches=2. Levels: {Levels}", 
                levels.Count, ticker, string.Join(", ", levels.Select(l => $"{l.Level:F2} (Touches:{l.TotalTouches})")));

            // If we got less than 2 levels, try with even more relaxed parameters
            if (levels.Count < 2)
            {
                _logger.LogWarning("Only found {Count} levels with minTotalTouches=2, trying with minTotalTouches=1", levels.Count);
                levels = _trendAnalyzer.DetectSupportResistanceLevels(priceData, minHighTouches: 1, minLowTouches: 1, minTotalTouches: 2, maxLevels: 0);
                _logger.LogInformation("Found {Count} support/resistance levels with minTotalTouches=1. Levels: {Levels}", 
                    levels.Count, string.Join(", ", levels.Select(l => $"{l.Level:F2} (Touches:{l.TotalTouches})")));
            }

            // Get all level values for the response
            var levelValues = levels.Select(l => l.Level).ToList();
            var firstTwo = levels.Count >= 2 
                ? new[] { levels[0].Level, levels[1].Level }
                : levels.Count == 1 
                    ? new[] { levels[0].Level }
                    : Array.Empty<decimal>();

            _logger.LogInformation("Selected first two levels for {Ticker}: {FirstTwo}", 
                ticker, string.Join(", ", firstTwo.Select(l => l.ToString("F2"))));

            return Ok(new
            {
                levels = levelValues.Select(l => l.ToString("F2")).ToList(),
                firstTwo = firstTwo.Select(l => l.ToString("F2")).ToList(),
                supportPrice = firstTwo.Length > 0 
                    ? string.Join(", ", firstTwo.Select(l => l.ToString("F2")))
                    : null,
                pricePointsCount = priceData.Count,
                allHighs = priceData.Select(p => p.High).OrderBy(h => h).ToList(),
                allLows = priceData.Select(p => p.Low).OrderBy(l => l).ToList(),
                levelsDetail = levels.Select(l => new
                {
                    level = l.Level.ToString("F2"),
                    lowBound = l.LowBound.ToString("F2"),
                    highBound = l.HighBound.ToString("F2"),
                    highTouches = l.HighTouches,
                    lowTouches = l.LowTouches,
                    totalTouches = l.TotalTouches,
                    score = l.Score,
                    firstTouch = l.FirstTouch.ToString("yyyy-MM-dd"),
                    lastTouch = l.LastTouch.ToString("yyyy-MM-dd")
                }).ToList()
            });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Alpha Vantage error for support/resistance {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to calculate support/resistance for {Ticker}. Exception: {ExceptionType}, Message: {Message}, StackTrace: {StackTrace}", 
                ticker, ex.GetType().Name, ex.Message, ex.StackTrace);
            return StatusCode(500, $"Internal error while calculating support/resistance: {ex.Message}");
        }
    }

    [HttpGet("{ticker}/average-volume")]
    public async Task<IActionResult> GetAverageWeeklyVolume(string ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        try
        {
            _logger.LogInformation("Calculating average weekly volume for {Ticker}", ticker);
            var priceData = await _alpha.GetWeeklyAsync(ticker);
            
            if (priceData.Count == 0)
                return NotFound("No data for this ticker");

            // Take only the last 52 weeks (or all if less than 52)
            // Since data is ordered by date ascending, the last items are the most recent
            var recentData = priceData.Count > 52 
                ? priceData.Skip(priceData.Count - 52).ToList()
                : priceData.ToList();

            _logger.LogInformation("Using {Count} weeks (out of {Total}) for average volume calculation for {Ticker}", 
                recentData.Count, priceData.Count, ticker);

            // Calculate average weekly volume (in shares) using only recent data
            var totalVolume = recentData.Sum(p => (long)p.Volume);
            var averageVolume = recentData.Count > 0 ? (double)totalVolume / recentData.Count : 0;

            // Calculate average volume in dollars (average volume * average price) using only recent data
            var averagePrice = recentData.Average(p => (double)(p.High + p.Low) / 2);
            var averageVolumeInDollars = averageVolume * averagePrice;

            // Log detailed calculation values
            _logger.LogInformation(
                "Volume calculation for {Ticker}: " +
                "TotalVolumeShares={TotalVolumeShares:N0}, " +
                "WeeksCount={WeeksCount}, " +
                "AverageVolumeShares={AverageVolumeShares:N0}, " +
                "AveragePrice={AveragePrice:F2}, " +
                "AverageVolumeInDollars={AverageVolumeInDollars:N2} (${AverageVolumeInDollarsFormatted})",
                ticker,
                totalVolume,
                recentData.Count,
                averageVolume,
                averagePrice,
                averageVolumeInDollars,
                FormatVolumeInDollars(averageVolumeInDollars)
            );

            // Log sample volume values from first, middle, and last weeks
            if (recentData.Count > 0)
            {
                var first = recentData.First();
                var last = recentData.Last();
                var middle = recentData[recentData.Count / 2];
                
                _logger.LogInformation(
                    "Sample volume data for {Ticker}: " +
                    "First week - Date={FirstDate}, Volume={FirstVolume:N0} shares, High={FirstHigh:F2}, Low={FirstLow:F2}, AvgPrice={FirstAvgPrice:F2}, VolumeInDollars={FirstVolumeDollars:N2}; " +
                    "Middle week - Date={MiddleDate}, Volume={MiddleVolume:N0} shares, High={MiddleHigh:F2}, Low={MiddleLow:F2}, AvgPrice={MiddleAvgPrice:F2}, VolumeInDollars={MiddleVolumeDollars:N2}; " +
                    "Last week - Date={LastDate}, Volume={LastVolume:N0} shares, High={LastHigh:F2}, Low={LastLow:F2}, AvgPrice={LastAvgPrice:F2}, VolumeInDollars={LastVolumeDollars:N2}",
                    ticker,
                    first.Date.ToString("yyyy-MM-dd"),
                    first.Volume,
                    first.High,
                    first.Low,
                    (double)(first.High + first.Low) / 2,
                    first.Volume * (double)(first.High + first.Low) / 2,
                    middle.Date.ToString("yyyy-MM-dd"),
                    middle.Volume,
                    middle.High,
                    middle.Low,
                    (double)(middle.High + middle.Low) / 2,
                    middle.Volume * (double)(middle.High + middle.Low) / 2,
                    last.Date.ToString("yyyy-MM-dd"),
                    last.Volume,
                    last.High,
                    last.Low,
                    (double)(last.High + last.Low) / 2,
                    last.Volume * (double)(last.High + last.Low) / 2
                );
            }

            // Determine volume category based on average volume in dollars with ±5% ranges
            // Option 1 (50M): 50M ± 5% = 47.5M to 52.5M
            // Option 2 (100M): 100M ± 5% = 95M to 105M
            // Option 3 (200M): 200M - 5% or higher = 190M to infinity
            int volumeCategory = 3; // Default to Big (200M)
            
            const double fiftyM = 50_000_000;
            const double hundredM = 100_000_000;
            const double twoHundredM = 200_000_000;
            const double fivePercent = 0.05;
            
            // Check if in 50M range (47.5M to 52.5M)
            if (averageVolumeInDollars >= fiftyM * (1 - fivePercent) && 
                averageVolumeInDollars <= fiftyM * (1 + fivePercent))
            {
                volumeCategory = 1; // 50M option
            }
            // Check if in 100M range (95M to 105M)
            else if (averageVolumeInDollars >= hundredM * (1 - fivePercent) && 
                     averageVolumeInDollars <= hundredM * (1 + fivePercent))
            {
                volumeCategory = 2; // 100M option
            }
            // Check if 200M - 5% or higher (190M to infinity)
            else if (averageVolumeInDollars >= twoHundredM * (1 - fivePercent))
            {
                volumeCategory = 3; // 200M option
            }
            // For values outside the ranges, assign to closest option
            else
            {
                if (averageVolumeInDollars < fiftyM * (1 + fivePercent)) // Less than 52.5M
                {
                    volumeCategory = 1; // Closest to 50M
                }
                else if (averageVolumeInDollars < twoHundredM * (1 - fivePercent)) // Less than 190M
                {
                    volumeCategory = 2; // Closest to 100M
                }
                else
                {
                    volumeCategory = 3; // 200M or higher
                }
            }

            _logger.LogInformation(
                "Volume category determined for {Ticker}: {Category} (value={Value:N2}, " +
                "50M range (47.5M-52.5M)={In50MRange}, " +
                "100M range (95M-105M)={In100MRange}, " +
                "200M+ range (190M+)={In200MRange})",
                ticker,
                volumeCategory == 1 ? "50M" : volumeCategory == 2 ? "100M" : "200M",
                averageVolumeInDollars,
                averageVolumeInDollars >= fiftyM * (1 - fivePercent) && averageVolumeInDollars <= fiftyM * (1 + fivePercent),
                averageVolumeInDollars >= hundredM * (1 - fivePercent) && averageVolumeInDollars <= hundredM * (1 + fivePercent),
                averageVolumeInDollars >= twoHundredM * (1 - fivePercent)
            );

            return Ok(new
            {
                averageVolume = averageVolume,
                averageVolumeFormatted = FormatVolume(averageVolume),
                averageVolumeInDollars = averageVolumeInDollars,
                averageVolumeInDollarsFormatted = FormatVolumeInDollars(averageVolumeInDollars),
                volumeCategory = volumeCategory, // 1, 2, or 3
                weeksCount = recentData.Count, // Count of weeks used in calculation
                totalWeeksAvailable = priceData.Count, // Total weeks available
                totalVolume = totalVolume
            });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Alpha Vantage error for average volume {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to calculate average weekly volume for {Ticker}. Exception: {ExceptionType}, Message: {Message}", 
                ticker, ex.GetType().Name, ex.Message);
            return StatusCode(500, $"Internal error: {ex.Message}");
        }
    }

    private string FormatVolume(double volume)
    {
        if (volume >= 1_000_000_000)
            return $"{volume / 1_000_000_000:F2}B";
        if (volume >= 1_000_000)
            return $"{volume / 1_000_000:F2}M";
        if (volume >= 1_000)
            return $"{volume / 1_000:F2}K";
        return volume.ToString("F0");
    }

    private string FormatVolumeInDollars(double volumeInDollars)
    {
        if (volumeInDollars >= 1_000_000_000)
            return $"${volumeInDollars / 1_000_000_000:F2}B";
        if (volumeInDollars >= 1_000_000)
            return $"${volumeInDollars / 1_000_000:F2}M";
        if (volumeInDollars >= 1_000)
            return $"${volumeInDollars / 1_000:F2}K";
        return $"${volumeInDollars:F2}";
    }

    [HttpGet("{ticker}/atr")]
    public async Task<IActionResult> GetAtr(string ticker, [FromQuery] int period = 14)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        if (period <= 0 || period > 100)
            return BadRequest("Period must be between 1 and 100");

        try
        {
            _logger.LogInformation("Calculating ATR for {Ticker} with period {Period}", ticker, period);
            var priceData = await _alpha.GetWeeklyAsync(ticker);
            
            if (priceData.Count == 0)
                return NotFound("No data for this ticker");

            // Calculate ATR
            var atrResult = AtrCalculator.CalculateAtr(priceData, period);
            
            _logger.LogInformation(
                "ATR calculated for {Ticker}: ATR={AtrValue:F4}, ATR%={AtrPercent:F2}%, Period={Period}, CandlesUsed={CandlesUsed}",
                ticker, atrResult.AtrValue, atrResult.AtrPercent, atrResult.Period, atrResult.CandlesUsed);

            return Ok(new
            {
                atr = atrResult.AtrValue.ToString("F4"),
                atrPercent = atrResult.AtrPercent?.ToString("F2"),
                period = atrResult.Period,
                candlesUsed = atrResult.CandlesUsed,
                latestClose = atrResult.LatestClose.ToString("F2"),
                trueRangesCount = atrResult.TrueRangesCount
            });
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Invalid argument for ATR calculation for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Cannot calculate ATR for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to calculate ATR for {Ticker}. Exception: {ExceptionType}, Message: {Message}", 
                ticker, ex.GetType().Name, ex.Message);
            return StatusCode(500, $"Internal error: {ex.Message}");
        }
    }

    [HttpPost("spy/fetch")]
    public async Task<IActionResult> FetchSpyData()
    {
        try
        {
            _logger.LogInformation("Manual SPY data fetch requested");
            var spyData = await _alpha.FetchSpyWeeklyDataAsync();
            
            _logger.LogInformation("SPY data fetch completed: {Count} data points", spyData.Count);
            
            return Ok(new
            {
                success = true,
                ticker = "SPY",
                dataPoints = spyData.Count,
                dateRange = new
                {
                    from = spyData.Min(p => p.Date).ToString("yyyy-MM-dd"),
                    to = spyData.Max(p => p.Date).ToString("yyyy-MM-dd")
                },
                message = $"Successfully fetched and saved {spyData.Count} SPY weekly data points"
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch SPY data: {Message}", ex.Message);
            return StatusCode(500, new
            {
                success = false,
                error = ex.Message
            });
        }
    }

    [HttpGet("{ticker}/beta")]
    public async Task<IActionResult> GetBeta(string ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        try
        {
            _logger.LogInformation("Calculating Beta for {Ticker} against SPY", ticker);

            // Получаем недельные данные актива
            var assetData = await _alpha.GetWeeklyAsync(ticker);
            if (assetData.Count == 0)
                return NotFound($"No weekly data found for {ticker}");

            // Получаем недельные данные SPY (бенчмарк)
            var spyData = await _alpha.GetWeeklyAsync("SPY");
            if (spyData.Count == 0)
                return StatusCode(503, "SPY benchmark data is not available. Please ensure SPY data has been fetched.");

            // Конвертируем PricePoint в WeeklyCandle
            var assetCandles = BetaService.ToWeeklyCandles(assetData);
            var spyCandles = BetaService.ToWeeklyCandles(spyData);

            // Add detailed logging before calculation
            _logger.LogInformation("Before Beta calculation - {Ticker}: {AssetCount} points, SPY: {SpyCount} points", 
                ticker, assetCandles.Count, spyCandles.Count);
            
            if (assetCandles.Count > 0 && spyCandles.Count > 0)
            {
                _logger.LogInformation("Asset date range: {Start} to {End}", 
                    assetCandles[0].Date, assetCandles[assetCandles.Count - 1].Date);
                _logger.LogInformation("SPY date range: {Start} to {End}", 
                    spyCandles[0].Date, spyCandles[spyCandles.Count - 1].Date);
            }

            // Рассчитываем Beta и Correlation
            var result = BetaService.CalculateBetaAndCorrelation(assetCandles, spyCandles);

            // Calculate volatility category from beta
            int volatilityCategory;
            try
            {
                volatilityCategory = VolatilityCategory.FromBeta(result.Beta);
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning(ex, "Invalid beta value for volatility category calculation: {Beta}", result.Beta);
                volatilityCategory = 0; // Use 0 to indicate invalid/unavailable
            }

            _logger.LogInformation("Beta calculation for {Ticker}: Beta={Beta:F4}, Correlation={Correlation:F4}, VolatilityCategory={VolCat}, Points={Points}",
                ticker, result.Beta, result.Correlation, volatilityCategory, result.PointsUsed);

            return Ok(new
            {
                ticker = ticker,
                benchmark = "SPY",
                beta = result.Beta,
                correlation = result.Correlation,
                volatilityCategory = volatilityCategory,
                pointsUsed = result.PointsUsed,
                assetDataPoints = assetData.Count,
                benchmarkDataPoints = spyData.Count
            });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Beta calculation error for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to calculate Beta for {Ticker}. Exception: {ExceptionType}, Message: {Message}",
                ticker, ex.GetType().Name, ex.Message);
            return StatusCode(500, $"Internal error: {ex.Message}");
        }
    }

    [HttpGet("{ticker}/movement")]
    public async Task<IActionResult> GetMovementMetrics(
        string ticker,
        [FromQuery] int? lookback = null,
        [FromQuery] string? periods = null,
        [FromQuery] double flatThresholdPct = 0.001)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        try
        {
            _logger.LogInformation("Calculating movement metrics for {Ticker}", ticker);
            var priceData = await _alpha.GetWeeklyAsync(ticker);
            
            if (priceData.Count == 0)
                return NotFound("No data for this ticker");

            // If periods are provided, calculate for multiple periods
            if (!string.IsNullOrWhiteSpace(periods))
            {
                var periodList = periods
                    .Split(',', StringSplitOptions.RemoveEmptyEntries)
                    .Select(p => int.TryParse(p.Trim(), out var val) ? val : (int?)null)
                    .Where(p => p.HasValue && p.Value >= 2)
                    .Select(p => p!.Value)
                    .ToList();

                if (periodList.Count == 0)
                    return BadRequest("Invalid periods format. Provide comma-separated integers (e.g., 26,52,104)");

                var metrics = MoveAnalyzer.CalculateNormalizedMoveMetricsForPeriods(
                    priceData,
                    periodList,
                    flatThresholdPct);

                _logger.LogInformation(
                    "Movement metrics calculated for {Ticker} for {PeriodCount} periods: {Periods}",
                    ticker, metrics.Count, string.Join(", ", metrics.Keys));

                return Ok(new
                {
                    ticker = ticker,
                    periods = metrics.Select(kvp => new
                    {
                        lookback = kvp.Key,
                        direction = kvp.Value.Direction,
                        returnPct = Math.Round(kvp.Value.ReturnPct, 4),
                        speedPct = Math.Round(kvp.Value.SpeedPct, 2),
                        strengthPct = Math.Round(kvp.Value.StrengthPct, 2),
                        easeOfMovePct = Math.Round(kvp.Value.EaseOfMovePct, 2)
                    }).ToList()
                });
            }
            // If single lookback is provided, calculate for that period
            else if (lookback.HasValue)
            {
                if (lookback.Value < 2)
                    return BadRequest("Lookback must be at least 2");

                var metrics = MoveAnalyzer.CalculateNormalizedMoveMetricsForPeriod(
                    priceData,
                    lookback.Value,
                    flatThresholdPct);

                _logger.LogInformation(
                    "Movement metrics calculated for {Ticker} with lookback={Lookback}: Direction={Direction}, Return={ReturnPct:F2}%, Speed={SpeedPct:F2}%, Strength={StrengthPct:F2}%, Ease={EasePct:F2}%",
                    ticker, lookback.Value, metrics.Direction, metrics.ReturnPct, metrics.SpeedPct, metrics.StrengthPct, metrics.EaseOfMovePct);

                return Ok(new
                {
                    ticker = ticker,
                    lookback = lookback.Value,
                    direction = metrics.Direction,
                    returnPct = Math.Round(metrics.ReturnPct, 4),
                    speedPct = Math.Round(metrics.SpeedPct, 2),
                    strengthPct = Math.Round(metrics.StrengthPct, 2),
                    easeOfMovePct = Math.Round(metrics.EaseOfMovePct, 2)
                });
            }
            else
            {
                return BadRequest("Either 'lookback' or 'periods' query parameter is required");
            }
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Invalid argument for movement metrics calculation for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Cannot calculate movement metrics for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to calculate movement metrics for {Ticker}. Exception: {ExceptionType}, Message: {Message}",
                ticker, ex.GetType().Name, ex.Message);
            return StatusCode(500, $"Internal error: {ex.Message}");
        }
    }

    [HttpGet("{ticker}/movement-score")]
    public async Task<IActionResult> GetMovementScore(
        string ticker,
        [FromQuery] int lookback = 26,
        [FromQuery] double wSpeed = 2.0,
        [FromQuery] double wStrength = 3.0,
        [FromQuery] double wEase = 1.0,
        [FromQuery] bool clampTo100 = false,
        [FromQuery] double flatThresholdPct = 0.001,
        [FromQuery] string timeframe = "Weekly")
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        if (lookback < 2)
            return BadRequest("Lookback must be at least 2");

        try
        {
            _logger.LogInformation("Calculating movement score for {Ticker} with lookback={Lookback}, timeframe={Timeframe}", ticker, lookback, timeframe);
            var priceData = await _alpha.GetWeeklyAsync(ticker);
            
            if (priceData.Count == 0)
                return NotFound("No data for this ticker");

            // Calculate normalized metrics first
            var metrics = MoveAnalyzer.CalculateNormalizedMoveMetricsForPeriod(
                priceData,
                lookback,
                flatThresholdPct);

            // Combine metrics into a single score
            var score = MoveScoreCombiner.Combine(
                metrics,
                wSpeed,
                wStrength,
                wEase,
                clampTo100);

            _logger.LogInformation(
                "Movement score calculated for {Ticker}: Magnitude={MagnitudePct:F2}%, Signed={SignedPct:F2}%",
                ticker, score.MagnitudePct, score.SignedPct);

            return Ok(new
            {
                ticker = ticker,
                lookback = lookback,
                magnitudePct = Math.Round(score.MagnitudePct, 2),
                signedPct = Math.Round(score.SignedPct, 2),
                direction = metrics.Direction,
                returnPct = Math.Round(metrics.ReturnPct, 4),
                speedPct = Math.Round(metrics.SpeedPct, 2),
                strengthPct = Math.Round(metrics.StrengthPct, 2),
                easeOfMovePct = Math.Round(metrics.EaseOfMovePct, 2),
                weights = new
                {
                    speed = wSpeed,
                    strength = wStrength,
                    ease = wEase
                },
                clampTo100 = clampTo100
            });
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Invalid argument for movement score calculation for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Cannot calculate movement score for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to calculate movement score for {Ticker}. Exception: {ExceptionType}, Message: {Message}",
                ticker, ex.GetType().Name, ex.Message);
            return StatusCode(500, $"Internal error: {ex.Message}");
        }
    }

    [HttpGet("composite/movement-score")]
    public async Task<IActionResult> GetCompositeMovementScore(
        [FromQuery] string tickers,
        [FromQuery] int lookback = 26,
        [FromQuery] double wSpeed = 2.0,
        [FromQuery] double wStrength = 3.0,
        [FromQuery] double wEase = 1.0,
        [FromQuery] bool clampTo100 = false,
        [FromQuery] double flatThresholdPct = 0.001)
    {
        if (string.IsNullOrWhiteSpace(tickers))
            return BadRequest("Parameter 'tickers' is required");

        var symbols = tickers
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.Trim().ToUpperInvariant())
            .Distinct()
            .ToList();

        if (symbols.Count < 2)
            return BadRequest("Provide at least 2 tickers for composite index");

        try
        {
            var seriesList = new List<IReadOnlyList<PricePoint>>();
            foreach (var symbol in symbols)
            {
                var data = await _alpha.GetWeeklyAsync(symbol);
                if (data.Count == 0)
                    return BadRequest($"No weekly data for ticker {symbol}");

                seriesList.Add(data);
            }

            var dateSets = seriesList
                .Select(list => list.Select(p => p.Date).ToHashSet())
                .ToList();

            var commonDates = dateSets
                .Skip(1)
                .Aggregate(
                    new HashSet<DateTime>(dateSets.First()),
                    (acc, set) =>
                    {
                        acc.IntersectWith(set);
                        return acc;
                    });

            if (commonDates.Count < lookback + 1)
                return BadRequest(
                    $"Not enough common history for all tickers. " +
                    $"Need at least {lookback + 1} common weekly bars, have {commonDates.Count}.");

            var orderedDates = commonDates
                .OrderBy(d => d)
                .ToList();

            var dicts = seriesList
                .Select(list => list.ToDictionary(p => p.Date))
                .ToList();

            var composite = new List<PricePoint>();
            foreach (var date in orderedDates)
            {
                var pointsAtDate = dicts.Select(d => d[date]).ToList();

                var open   = pointsAtDate.Average(p => p.Open);
                var high   = pointsAtDate.Average(p => p.High);
                var low    = pointsAtDate.Average(p => p.Low);
                var close  = pointsAtDate.Average(p => p.Close);
                var volume = pointsAtDate.Sum(p => p.Volume);

                composite.Add(new PricePoint
                {
                    Date   = date,
                    Open   = open,
                    High   = high,
                    Low    = low,
                    Close  = close,
                    Volume = volume
                });
            }

            var metrics = MoveAnalyzer.CalculateNormalizedMoveMetricsForPeriod(
                composite,
                lookback,
                flatThresholdPct);

            var score = MoveScoreCombiner.Combine(
                metrics,
                wSpeed,
                wStrength,
                wEase,
                clampTo100);

            var name = string.Join("+", symbols);

            _logger.LogInformation(
                "Composite movement score calculated for {Tickers}: Magnitude={MagnitudePct:F2}%, Signed={SignedPct:F2}%",
                name, score.MagnitudePct, score.SignedPct);

            return Ok(new
            {
                ticker = name,
                lookback = lookback,
                magnitudePct = Math.Round(score.MagnitudePct, 2),
                signedPct = Math.Round(score.SignedPct, 2),
                direction = metrics.Direction,
                returnPct = Math.Round(metrics.ReturnPct, 4),
                speedPct = Math.Round(metrics.SpeedPct, 2),
                strengthPct = Math.Round(metrics.StrengthPct, 2),
                easeOfMovePct = Math.Round(metrics.EaseOfMovePct, 2),
                weights = new
                {
                    speed = wSpeed,
                    strength = wStrength,
                    ease = wEase
                },
                clampTo100 = clampTo100,
                components = symbols
            });
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Invalid argument for composite movement score calculation for {Tickers}: {Message}", tickers, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Cannot calculate composite movement score for {Tickers}: {Message}", tickers, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to calculate composite movement score for {Tickers}. Exception: {ExceptionType}, Message: {Message}",
                tickers, ex.GetType().Name, ex.Message);
            return StatusCode(500, $"Internal error: {ex.Message}");
        }
    }
}
