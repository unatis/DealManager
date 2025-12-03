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
            _logger.LogInformation("Fetching weekly prices for {Ticker}", ticker);
            var data = await _alpha.GetWeeklyAsync(ticker);
            _logger.LogInformation("Retrieved {Count} price points for {Ticker}", data.Count, ticker);
            
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
                weeklyTrend = _trendAnalyzer.DetectTrendByLowsForWeeks(priceData, weeks: 2);
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
            var levels = _trendAnalyzer.DetectSupportResistanceLevels(priceData, minHighTouches: 1, minLowTouches: 1, minTotalTouches: 2, maxLevels: 10);
            _logger.LogInformation("Found {Count} support/resistance levels for {Ticker} with minTotalTouches=2. Levels: {Levels}", 
                levels.Count, ticker, string.Join(", ", levels.Select(l => $"{l.Level:F2} (Touches:{l.TotalTouches})")));

            // If we got less than 2 levels, try with even more relaxed parameters
            if (levels.Count < 2)
            {
                _logger.LogWarning("Only found {Count} levels with minTotalTouches=2, trying with minTotalTouches=1", levels.Count);
                levels = _trendAnalyzer.DetectSupportResistanceLevels(priceData, minHighTouches: 1, minLowTouches: 1, minTotalTouches: 1, maxLevels: 10);
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
}
