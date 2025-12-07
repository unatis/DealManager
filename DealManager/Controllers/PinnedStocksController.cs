using DealManager.Models;
using DealManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace DealManager.Controllers
{
    [ApiController]
    [Route("api/pinnedstocks")]
    [Authorize]
    public class PinnedStocksController : ControllerBase
    {
        private readonly PinnedStocksService _service;

        public PinnedStocksController(PinnedStocksService service)
        {
            _service = service;
        }

        private string GetUserId()
        {
            // Аналогично StocksController/DealsController
            var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)
                         ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);

            if (string.IsNullOrEmpty(userId))
                throw new InvalidOperationException("No user id in JWT");

            return userId;
        }

        [HttpGet]
        public async Task<ActionResult<List<PinnedStock>>> GetAll()
        {
            var userId = GetUserId();
            var list = await _service.GetAllForOwnerAsync(userId);
            return Ok(list);
        }

        public class CreatePinnedStockDto
        {
            public string Ticker { get; set; } = string.Empty;
        }

        [HttpPost]
        public async Task<ActionResult<PinnedStock>> Create([FromBody] CreatePinnedStockDto dto)
        {
            var userId = GetUserId();
            if (string.IsNullOrWhiteSpace(dto.Ticker))
            {
                return BadRequest("Ticker is required");
            }

            var created = await _service.CreateAsync(userId, dto.Ticker);
            return CreatedAtAction(nameof(GetAll), new { id = created.Id }, created);
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(string id)
        {
            var userId = GetUserId();
            var ok = await _service.DeleteAsync(id, userId);
            if (!ok) return NotFound();

            return NoContent();
        }

        public class ReorderDto
        {
            public List<string> OrderedIds { get; set; } = new();
        }

        [HttpPost("reorder")]
        public async Task<IActionResult> Reorder([FromBody] ReorderDto dto)
        {
            var userId = GetUserId();
            await _service.UpdateOrderAsync(userId, dto.OrderedIds ?? new List<string>());
            return NoContent();
        }
    }
}


