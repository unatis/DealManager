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

        public DealsController(DealsService service)
        {
            _service = service;
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

            // жёстко привязываем к текущему пользователю,
            // игнорируя всё, что придёт с фронта
            deal.UserId = userId;

            await _service.CreateAsync(deal);
            return CreatedAtAction(nameof(GetAll), new { id = deal.Id }, deal);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Update(string id, [FromBody] Deal deal)
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            var ok = await _service.UpdateAsync(id, userId, deal);
            if (!ok) return NotFound(); // либо сделки нет, либо она чужая

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
