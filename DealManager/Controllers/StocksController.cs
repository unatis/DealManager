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

        public StocksController(StocksService service)
        {
            _service = service;
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
        public record StockDto(string Ticker, string? Desc, bool Sp500Member, bool AverageWeekVol);

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
                AverageWeekVol = dto.AverageWeekVol
            };

            await _service.CreateAsync(stock);
            return CreatedAtAction(nameof(GetAll), new { id = stock.Id }, stock);
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(string id)
        {
            var userId = GetUserId();
            await _service.DeleteAsync(id, userId);
            return NoContent();
        }
    }
}

