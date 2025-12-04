using DealManager.Models;
using DealManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;

namespace DealManager.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class StocksController : ControllerBase
    {
        private readonly StocksService _service;
        private readonly WarningsService _warningsService;

        public StocksController(StocksService service, WarningsService warningsService)
        {
            _service = service;
            _warningsService = warningsService;
        }

        private string GetUserId()
        {
            // пробуем стандартный NameIdentifier
            var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)
                         // на всякий случай — прямой sub
                         ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);

            if (string.IsNullOrEmpty(userId))
                throw new InvalidOperationException("No user id in JWT");

            return userId;
        }

        // DTO, который будем принимать с фронта
        public record StockDto(string Ticker, string? Desc, bool Sp500Member, string? RegularVolume);

        [HttpGet]
        public async Task<ActionResult<List<Stock>>> GetAll()
        {
            var userId = GetUserId();
            var items = await _service.GetAllForOwnerAsync(userId);
            return items;
        }

        [HttpPost]
        public async Task<ActionResult<Stock>> Create(StockDto dto)
        {
            var userId = GetUserId();

            var stock = new Stock
            {
                OwnerId = userId,
                Ticker = dto.Ticker,
                Desc = dto.Desc,
                Sp500Member = dto.Sp500Member,
                RegularVolume = dto.RegularVolume
            };

            await _service.CreateAsync(stock);
            
            // Save warning if regular_volume is "1" (red/50M option)
            if (dto.RegularVolume == "1")
            {
                await _warningsService.UpsertWarningAsync(userId, dto.Ticker, regularShareVolume: true);
            }
            else
            {
                // Remove warning if regular_volume is not "1"
                await _warningsService.UpsertWarningAsync(userId, dto.Ticker, regularShareVolume: false);
            }
            
            return CreatedAtAction(nameof(GetAll), new { id = stock.Id }, stock);
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(string id)
        {
            var userId = GetUserId();
            
            // Get stock to find ticker before deleting
            var stocks = await _service.GetAllForOwnerAsync(userId);
            var stock = stocks.FirstOrDefault(s => s.Id == id);
            
            await _service.DeleteAsync(id, userId);
            
            // Also delete warning if stock exists
            if (stock != null)
            {
                await _warningsService.DeleteWarningAsync(userId, stock.Ticker);
            }
            
            return NoContent();
        }

        [HttpGet("warnings")]
        public async Task<ActionResult<List<Warning>>> GetWarnings()
        {
            var userId = GetUserId();
            var warnings = await _warningsService.GetAllWarningsForOwnerAsync(userId);
            return warnings;
        }

        [HttpGet("warnings/{ticker}")]
        public async Task<ActionResult<Warning?>> GetWarning(string ticker)
        {
            var userId = GetUserId();
            var warning = await _warningsService.GetWarningAsync(userId, ticker);
            if (warning == null)
                return NotFound();
            return warning;
        }
    }
}

