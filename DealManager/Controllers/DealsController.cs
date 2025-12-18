using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Globalization;
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

        private static bool TryParsePositiveDecimal(string? s, out decimal value)
        {
            value = 0m;
            if (string.IsNullOrWhiteSpace(s)) return false;
            var normalized = s.Trim().Replace(',', '.');
            return decimal.TryParse(normalized, NumberStyles.Any, CultureInfo.InvariantCulture, out value) && value > 0;
        }

        private static decimal? TryCalculateTotalSumFromStages(Deal deal)
        {
            if (!TryParsePositiveDecimal(deal.SharePrice, out var price)) return null;
            if (deal.Amount_tobuy_stages == null || deal.Amount_tobuy_stages.Count == 0) return null;

            decimal shares = 0m;
            foreach (var s in deal.Amount_tobuy_stages)
            {
                if (!TryParsePositiveDecimal(s, out var n)) return null;
                shares += n;
            }

            if (shares <= 0 || price <= 0) return null;
            return Math.Round(price * shares, 2);
        }

        private static string? ValidateStagesStrict(Deal deal)
        {
            // Block old client payload (Variant A)
            if (!string.IsNullOrWhiteSpace(deal.Amount_tobuy_stage_1) ||
                !string.IsNullOrWhiteSpace(deal.Amount_tobuy_stage_2))
            {
                return "Old deal format is not supported. Use amount_tobuy_stages.";
            }

            if (deal.Amount_tobuy_stages == null || deal.Amount_tobuy_stages.Count < 1)
                return "amount_tobuy_stages is required and must have at least 1 stage.";

            foreach (var s in deal.Amount_tobuy_stages)
            {
                if (!TryParsePositiveDecimal(s, out _))
                    return "All amount_tobuy_stages values must be positive numbers.";
            }

            return null;
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

            // Strictly require stop_loss_prcnt > 0
            if (!TryParsePositiveDecimal(deal.StopLossPercent, out _))
                return BadRequest("stop_loss_prcnt is required and must be a positive number.");

            // Strict stages validation (Variant B only)
            var stagesError = ValidateStagesStrict(deal);
            if (stagesError != null)
                return BadRequest(stagesError);

            // Если сделка создаётся сразу как реальная (не planned) – проставим время активации
            if (!deal.PlannedFuture && deal.ActivatedAt == null)
            {
                deal.ActivatedAt = DateTime.UtcNow;
            }

            // Validate and parse total_sum if provided; otherwise compute from stages
            decimal? totalSumValue = null;
            if (!string.IsNullOrWhiteSpace(deal.TotalSum))
            {
                if (!decimal.TryParse(deal.TotalSum, out var parsedTotalSum) || parsedTotalSum < 0)
                {
                    return BadRequest("Invalid total_sum value. Must be a non-negative number.");
                }
                totalSumValue = parsedTotalSum;
            }
            else
            {
                totalSumValue = TryCalculateTotalSumFromStages(deal);
                if (totalSumValue.HasValue)
                {
                    deal.TotalSum = totalSumValue.Value.ToString(CultureInfo.InvariantCulture);
                }
            }

            // Create the deal
            await _service.CreateAsync(deal);

            // Deduct portfolio on server-side (secure) only for active (non-planned) deals
            if (!deal.PlannedFuture && totalSumValue.HasValue && totalSumValue.Value > 0)
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

            // Получаем текущее состояние сделки, чтобы понять, был ли переход из planned -> active
            var existing = await _service.GetAsync(id, userId);
            if (existing == null)
                return NotFound();

            // Strictly require stop_loss_prcnt > 0
            if (!TryParsePositiveDecimal(deal.StopLossPercent, out _))
                return BadRequest("stop_loss_prcnt is required and must be a positive number.");

            // Strict stages validation (Variant B only)
            var stagesError = ValidateStagesStrict(deal);
            if (stagesError != null)
                return BadRequest(stagesError);

            // Validate and parse total_sum if provided; otherwise compute from stages
            decimal? totalSumValue = null;
            if (!string.IsNullOrWhiteSpace(deal.TotalSum))
            {
                if (!decimal.TryParse(deal.TotalSum, out var parsedTotalSum) || parsedTotalSum < 0)
                {
                    return BadRequest("Invalid total_sum value. Must be a non-negative number.");
                }
                totalSumValue = parsedTotalSum;
            }
            else
            {
                totalSumValue = TryCalculateTotalSumFromStages(deal);
                if (totalSumValue.HasValue)
                {
                    deal.TotalSum = totalSumValue.Value.ToString(CultureInfo.InvariantCulture);
                }
            }

            // Копируем технические поля
            deal.UserId = userId;
            deal.OwnerId = userId; // Ensure OwnerId is set on update too

            // Если это активация плана (PlannedFuture: true -> false), проставим ActivatedAt один раз
            var isActivation = existing.PlannedFuture && !deal.PlannedFuture;
            if (isActivation)
            {
                // Block activation if trends are Down (planning is allowed; activation is not).
                // Use incoming values if provided, otherwise fall back to existing persisted values.
                var monthly = deal.MonthlyDir ?? existing.MonthlyDir ?? string.Empty;
                var weekly  = deal.WeeklyDir  ?? existing.WeeklyDir  ?? string.Empty;
                if (string.Equals(monthly, "Down", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(weekly, "Down", StringComparison.OrdinalIgnoreCase))
                {
                    return BadRequest("Cannot activate deal: Weekly trend or Monthly trend is Down.");
                }

                // Если раньше не было – считаем, что это первая активация
                deal.ActivatedAt = existing.ActivatedAt ?? DateTime.UtcNow;
            }
            else
            {
                // В остальных случаях сохраняем предыдущее значение, если клиент его не установил явно
                if (deal.ActivatedAt == null)
                {
                    deal.ActivatedAt = existing.ActivatedAt;
                }
            }

            // Определяем, закрывается ли сейчас активная (не planned) сделка
            var isClosingActive = !existing.Closed && deal.Closed && !existing.PlannedFuture;

            var ok = await _service.UpdateAsync(id, userId, deal);
            if (!ok) return NotFound();

            // Если это была активация плана (planned -> active) и есть валидная сумма — режем портфель
            if (isActivation && totalSumValue.HasValue && totalSumValue.Value > 0)
            {
                var portfolioDeducted = await _users.DeductPortfolioAsync(userId, totalSumValue.Value);
                if (!portfolioDeducted)
                {
                    // Логируем, но не валим запрос — сделка уже обновлена
                }
            }

            // Если это закрытие активной (не planned) сделки и есть валидная сумма — возвращаем деньги в портфель
            if (isClosingActive && totalSumValue.HasValue && totalSumValue.Value > 0)
            {
                var portfolioIncreased = await _users.AddPortfolioAsync(userId, totalSumValue.Value);
                if (!portfolioIncreased)
                {
                    // Аналогично: логируем, но не валим запрос
                }
            }

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

        [HttpGet("limits")]
        public async Task<ActionResult<DealLimitResult>> GetDealLimits([FromQuery] decimal stopLossPercent)
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            if (stopLossPercent <= 0)
                return BadRequest("stopLossPercent must be > 0");

            var limits = await _riskService.CalculateDealLimitsAsync(userId, stopLossPercent);
            return Ok(limits);
        }

        [HttpGet("weekly-activations")]
        public async Task<ActionResult<object>> GetWeeklyActivations()
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            var count = await _service.GetWeeklyActivationsCountAsync(userId);
            const int maxPerWeek = 2;

            return Ok(new
            {
                count,
                maxPerWeek,
                exceeds = count >= maxPerWeek
            });
        }
    }
}
