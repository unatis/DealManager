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
        private readonly UsersService _users;
        private readonly IRiskService _riskService;

        public DealsController(DealsService service, StocksService stocks, UsersService users, IRiskService riskService)
        {
            _service = service;
            _stocks = stocks;
            _users = users;
            _riskService = riskService;
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
            var exists = await _stocks.ExistsForUserAsync(userId, deal.Stock);
            if (!exists)
                return BadRequest("You can create deals only for stocks from your list.");

            // жёстко привязываем к текущему пользователю
            deal.UserId = userId;
            deal.OwnerId = userId; // Set OwnerId for GetAllForOwnerAsync queries

            // Set default date if not provided
            if (string.IsNullOrWhiteSpace(deal.Date))
            {
                deal.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
            }

            // Validate and parse total_sum if provided
            decimal? totalSumValue = null;
            if (!string.IsNullOrWhiteSpace(deal.TotalSum))
            {
                if (!decimal.TryParse(deal.TotalSum, out var parsedTotalSum) || parsedTotalSum < 0)
                {
                    return BadRequest("Invalid total_sum value. Must be a non-negative number.");
                }
                totalSumValue = parsedTotalSum;
            }

            // Create the deal
            await _service.CreateAsync(deal);

            // Deduct portfolio on server-side (secure)
            if (totalSumValue.HasValue && totalSumValue.Value > 0)
            {
                var portfolioDeducted = await _users.DeductPortfolioAsync(userId, totalSumValue.Value);
                if (!portfolioDeducted)
                {
                    // Log warning but don't fail the deal creation
                    // The deal was already created, so we just log the portfolio deduction failure
                }
            }

            // Calculate portfolio risk percentage after deal creation
            var riskPercent = await _riskService.CalculatePortfolioRiskPercentAsync(userId);

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

            // Validate total_sum if provided
            if (!string.IsNullOrWhiteSpace(deal.TotalSum))
            {
                if (!decimal.TryParse(deal.TotalSum, out var parsedTotalSum) || parsedTotalSum < 0)
                {
                    return BadRequest("Invalid total_sum value. Must be a non-negative number.");
                }
            }

            deal.UserId = userId;
            deal.OwnerId = userId; // Ensure OwnerId is set on update too

            var ok = await _service.UpdateAsync(id, userId, deal);
            if (!ok) return NotFound();

            // Calculate portfolio risk percentage after deal update
            var riskPercent = await _riskService.CalculatePortfolioRiskPercentAsync(userId);

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

        [HttpGet("risk-percent")]
        public async Task<ActionResult<decimal>> GetPortfolioRiskPercent()
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            var riskPercent = await _riskService.CalculatePortfolioRiskPercentAsync(userId);
            return Ok(riskPercent);
        }

        [HttpGet("risk-percent-inshares")]
        public async Task<ActionResult<decimal>> GetInSharesRiskPercent()
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            var riskPercent = await _riskService.CalculateInSharesRiskPercentAsync(userId);
            return Ok(riskPercent);
        }
    }
}
