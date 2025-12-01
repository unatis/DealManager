using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using DealManager.Models;
using DealManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DealManager.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class DealsController : ControllerBase
    {
        private readonly DealsService _service;
        private readonly StocksService _stocks;

        public DealsController(DealsService service, StocksService stocks)
        {
            _service = service;
            _stocks = stocks;
        }

        private string? GetUserId()
        {
            // sub мы кладём в токен в AuthController
            return User.FindFirstValue(JwtRegisteredClaimNames.Sub)
                   ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        }

        [HttpGet]
        public async Task<ActionResult<List<Deal>>> GetAll()
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            var deals = await _service.GetByUserAsync(userId);
            return deals;
        }

        [HttpPost]
        public async Task<ActionResult<Deal>> Create([FromBody] Deal deal)
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            // обязательно должен быть тикер
            if (string.IsNullOrWhiteSpace(deal.Stock))
                return BadRequest("Stock ticker is required.");

            // проверяем, что у этого пользователя есть такая акция в списке
            // ВАЖНО: в StocksService должен быть метод ExistsForUserAsync(string userId, string ticker)
            var exists = await _stocks.ExistsForUserAsync(userId, deal.Stock);
            if (!exists)
                return BadRequest("You can create deals only for stocks from your list.");

            // жёстко привязываем к текущему пользователю
            deal.UserId = userId;

            await _service.CreateAsync(deal);
            return CreatedAtAction(nameof(GetAll), new { id = deal.Id }, deal);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Update(string id, [FromBody] Deal deal)
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            if (string.IsNullOrWhiteSpace(deal.Stock))
                return BadRequest("Stock ticker is required.");

            var exists = await _stocks.ExistsForUserAsync(userId, deal.Stock);
            if (!exists)
                return BadRequest("You can update deals only for stocks from your list.");

            deal.UserId = userId;

            var ok = await _service.UpdateAsync(id, userId, deal);
            if (!ok) return NotFound();

            return NoContent();
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(string id)
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            var ok = await _service.DeleteAsync(id, userId);
            if (!ok) return NotFound();

            return NoContent();
        }
    }
}
