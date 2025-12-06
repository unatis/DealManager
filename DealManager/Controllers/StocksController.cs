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

        private bool IsAtrHighRisk(string? atr)
        {
            if (string.IsNullOrWhiteSpace(atr))
                return false;

            // Parse ATR string format: "2.3456 (1.23%)" or just "2.3456"
            // Extract percentage from parentheses
            var match = System.Text.RegularExpressions.Regex.Match(atr, @"\(([\d.]+)%\)");
            if (match.Success && match.Groups.Count > 1)
            {
                if (double.TryParse(match.Groups[1].Value, out double percent))
                {
                    return percent > 10.0;
                }
            }

            return false;
        }

        // DTO, который будем принимать с фронта
        public record StockDto(string Ticker, string? Desc, bool Sp500Member, string? RegularVolume, string? SyncSp500, string? BetaVolatility, string? Atr);

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

            Console.WriteLine($"[Stock Create] Received BetaVolatility: '{dto.BetaVolatility}'");

            var stock = new Stock
            {
                OwnerId = userId,
                Ticker = dto.Ticker,
                Desc = dto.Desc,
                Sp500Member = dto.Sp500Member,
                RegularVolume = dto.RegularVolume,
                SyncSp500 = dto.SyncSp500,
                BetaVolatility = dto.BetaVolatility,
                Atr = dto.Atr
            };

            // Assign order so that new stock goes to the bottom of the list
            var existing = await _service.GetAllForOwnerAsync(userId);
            stock.Order = existing.Count == 0 ? 0 : existing.Max(s => s.Order) + 1;

            Console.WriteLine($"[Stock Create] Stock.BetaVolatility before save: '{stock.BetaVolatility}'");

            await _service.CreateAsync(stock);
            
            Console.WriteLine($"[Stock Create] Stock.BetaVolatility after save: '{stock.BetaVolatility}'");
            
            // Save warnings - call once with all parameters
            // Use StockId for unique identification (allows multiple stocks with same ticker)
            bool regularVolumeWarning = dto.RegularVolume == "1";
            bool sp500Warning = !dto.Sp500Member; // Warning if NOT a member
            bool atrWarning = IsAtrHighRisk(dto.Atr); // Warning if ATR > 10%
            bool syncSp500Warning = dto.SyncSp500 == "no"; // Warning if NOT synchronized
            bool betaVolatilityWarning = dto.BetaVolatility == "3"; // Warning if High volatility
            
            await _warningsService.UpsertWarningAsync(
                userId, 
                dto.Ticker, 
                regularShareVolume: regularVolumeWarning,
                sp500Member: sp500Warning,
                atrHighRisk: atrWarning,
                syncSp500No: syncSp500Warning,
                betaVolatilityHigh: betaVolatilityWarning,
                stockId: stock.Id  // Pass StockId for unique identification
            );
            
            return CreatedAtAction(nameof(GetAll), new { id = stock.Id }, stock);
        }

        // Reorder stocks for current user (drag & drop)
        [HttpPost("reorder")]
        public async Task<IActionResult> Reorder([FromBody] string[] orderedIds)
        {
            var userId = GetUserId();
            if (orderedIds == null || orderedIds.Length == 0)
                return BadRequest("No ids provided");

            for (int i = 0; i < orderedIds.Length; i++)
            {
                var id = orderedIds[i];
                await _service.UpdateOrderAsync(userId, id, i);
            }

            return NoContent();
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
            // Use StockId for deletion to ensure correct warning is deleted
            if (stock != null)
            {
                await _warningsService.DeleteWarningAsync(userId, stock.Ticker, stockId: id);
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
            stock.BetaVolatility = dto.BetaVolatility;
            stock.Atr = dto.Atr;

            await _service.UpdateAsync(id, userId, stock);
            
            // Update warnings - call once with all parameters
            // Use StockId for unique identification (allows multiple stocks with same ticker)
            bool regularVolumeWarning = dto.RegularVolume == "1";
            bool sp500Warning = !dto.Sp500Member; // Warning if NOT a member
            bool atrWarning = IsAtrHighRisk(dto.Atr); // Warning if ATR > 10%
            bool syncSp500Warning = dto.SyncSp500 == "no"; // Warning if NOT synchronized
            bool betaVolatilityWarning = dto.BetaVolatility == "3"; // Warning if High volatility
            
            await _warningsService.UpsertWarningAsync(
                userId, 
                dto.Ticker, 
                regularShareVolume: regularVolumeWarning,
                sp500Member: sp500Warning,
                atrHighRisk: atrWarning,
                syncSp500No: syncSp500Warning,
                betaVolatilityHigh: betaVolatilityWarning,
                stockId: id  // Pass StockId for unique identification
            );
            
            return Ok(stock);
        }
    }
}

