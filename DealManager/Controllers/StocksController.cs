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
        public record StockDto(string Ticker, string? Desc, bool Sp500Member, string? RegularVolume, string? SyncSp500);

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
                RegularVolume = dto.RegularVolume,
                SyncSp500 = dto.SyncSp500
            };

            await _service.CreateAsync(stock);
            
            // Save warnings - call once with both parameters
            bool regularVolumeWarning = dto.RegularVolume == "1";
            bool sp500Warning = !dto.Sp500Member; // Warning if NOT a member
            
            await _warningsService.UpsertWarningAsync(
                userId, 
                dto.Ticker, 
                regularShareVolume: regularVolumeWarning,
                sp500Member: sp500Warning
            );
            
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

        [HttpPut("{id}")]
        public async Task<ActionResult<Stock>> Update(string id, StockDto dto)
        {
            var userId = GetUserId();
            
            var stock = await _service.GetByIdAsync(id, userId);
            if (stock == null) return NotFound();

            stock.Ticker = dto.Ticker;
            stock.Desc = dto.Desc;
            stock.Sp500Member = dto.Sp500Member;
            stock.RegularVolume = dto.RegularVolume;
            stock.SyncSp500 = dto.SyncSp500;

            await _service.UpdateAsync(id, userId, stock);
            
            // Update warnings - call once with both parameters
            bool regularVolumeWarning = dto.RegularVolume == "1";
            bool sp500Warning = !dto.Sp500Member; // Warning if NOT a member
            
            await _warningsService.UpsertWarningAsync(
                userId, 
                dto.Ticker, 
                regularShareVolume: regularVolumeWarning,
                sp500Member: sp500Warning
            );
            
            return Ok(stock);
        }
    }
}

