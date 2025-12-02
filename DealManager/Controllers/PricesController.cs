using DealManager.Services;
using Microsoft.AspNetCore.Mvc;

namespace DealManager.Controllers;

[ApiController]
[Route("api/[controller]")]
// [Authorize]  // можно вернуть, если хочешь защищать графики токеном
public class PricesController : ControllerBase
{
    private readonly AlphaVantageService _alpha;
    private readonly ILogger<PricesController> _logger;

    public PricesController(AlphaVantageService alpha, ILogger<PricesController> logger)
    {
        _alpha = alpha;
        _logger = logger;
    }

    [HttpGet("{ticker}")]
    public async Task<IActionResult> Get(string ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        try
        {
            var data = await _alpha.GetWeeklyAsync(ticker);
            if (data.Count == 0)
                return NotFound("No data for this ticker");

            return Ok(data);
        }
        catch (InvalidOperationException ex)
        {
            // читабельные ошибки от Alpha Vantage
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load prices for {Ticker}", ticker);
            return StatusCode(500, "Internal error while loading prices");
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
            return BadRequest(ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load quote for {Ticker}", ticker);
            return StatusCode(500, "Internal error while loading quote");
        }
    }
}
