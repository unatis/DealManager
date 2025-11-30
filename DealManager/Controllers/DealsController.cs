using DealManager.Models;
using DealManager.Services;
using Microsoft.AspNetCore.Mvc;

namespace DealManager.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class DealsController : ControllerBase
    {
        private readonly DealsService _service;

        public DealsController(DealsService service)
        {
            _service = service;
        }

        [HttpGet]
        public async Task<ActionResult<List<Deal>>> GetAll()
            => await _service.GetAllAsync();

        [HttpPost]
        public async Task<ActionResult<Deal>> Create(Deal deal)
        {
            await _service.CreateAsync(deal);
            return CreatedAtAction(nameof(GetAll), new { id = deal.Id }, deal);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Update(string id, Deal deal)
        {
            deal.Id = id;
            await _service.UpdateAsync(id, deal);
            return NoContent();
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(string id)
        {
            await _service.DeleteAsync(id);
            return NoContent();
        }
    }
}
