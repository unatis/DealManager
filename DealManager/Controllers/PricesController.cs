using DealManager.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System;
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
}
