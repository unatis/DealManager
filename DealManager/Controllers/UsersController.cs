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

    [HttpPut("portfolio")]
    public async Task<IActionResult> UpdatePortfolio([FromBody] PortfolioRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        await _users.UpdatePortfolioAsync(userId, request.Portfolio);
        return NoContent();
    }
}


