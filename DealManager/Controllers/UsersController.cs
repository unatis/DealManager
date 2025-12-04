using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using DealManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DealManager.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly UsersService _users;

    public UsersController(UsersService users)
    {
        _users = users;
    }

    private string? GetUserId() =>
        User.FindFirstValue(JwtRegisteredClaimNames.Sub)
        ?? User.FindFirstValue(ClaimTypes.NameIdentifier);

    public record PortfolioRequest(double Portfolio);

    [HttpGet("portfolio")]
    public async Task<ActionResult<PortfolioRequest>> GetPortfolio()
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var portfolio = await _users.GetPortfolioAsync(userId);
        return Ok(new PortfolioRequest((double)portfolio));
    }

    [HttpPut("portfolio")]
    public async Task<IActionResult> UpdatePortfolio([FromBody] PortfolioRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        await _users.UpdatePortfolioAsync(userId, request.Portfolio);
        return NoContent();
    }
}




