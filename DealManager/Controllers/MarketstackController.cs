using DealManager.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System;
using System.Threading.Tasks;

namespace DealManager.Controllers;

[ApiController]
[Route("api/marketstack")]
public class MarketstackController : ControllerBase
{
    private readonly MarketstackService _marketstack;
    private readonly ILogger<MarketstackController> _logger;

    public MarketstackController(
        MarketstackService marketstack,
        ILogger<MarketstackController> logger)
    {
        _marketstack = marketstack;
        _logger = logger;
    }

    [HttpGet("{ticker}/weekly")]
    public async Task<IActionResult> GetWeekly(string ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        try
        {
            _logger.LogInformation("Fetching weekly prices from Marketstack for {Ticker}", ticker);
            var data = await _marketstack.GetWeeklyAsync(ticker, yearsBack: 2);
            Response.Headers["X-Price-Source"] = "marketstack";

            if (data.Count == 0)
                return NotFound("No data for this ticker");

            return Ok(data);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Marketstack error for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load Marketstack weekly prices for {Ticker}. Exception: {ExceptionType}, Message: {Message}", 
                ticker, ex.GetType().Name, ex.Message);
            return StatusCode(500, $"Internal error while loading Marketstack weekly prices: {ex.Message}");
        }
    }

    [HttpGet("{ticker}/quote")]
    public async Task<IActionResult> GetQuote(string ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        try
        {
            var quote = await _marketstack.GetCurrentQuoteAsync(ticker);
            Response.Headers["X-Price-Source"] = "marketstack";
            if (quote == null)
                return NotFound("No current price available for this ticker");

            return Ok(new { price = quote.Price, lastUpdatedUtc = quote.LastUpdatedUtc });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Marketstack error for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Invalid argument for {Ticker}: {Message}", ticker, ex.Message);
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load Marketstack quote for {Ticker}. Exception: {ExceptionType}, Message: {Message}", 
                ticker, ex.GetType().Name, ex.Message);
            return StatusCode(500, $"Internal error while loading Marketstack quote: {ex.Message}");
        }
    }
}
