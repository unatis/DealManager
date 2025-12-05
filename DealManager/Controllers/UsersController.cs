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
    public record TotalSumRequest(double TotalSum);
    public record InSharesRequest(double InShares);

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

    [HttpGet("totalsum")]
    public async Task<ActionResult<TotalSumRequest>> GetTotalSum()
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var totalSum = await _users.GetTotalSumAsync(userId);
        return Ok(new TotalSumRequest((double)totalSum));
    }

    [HttpPut("totalsum")]
    public async Task<IActionResult> UpdateTotalSum([FromBody] TotalSumRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        await _users.UpdateTotalSumAsync(userId, request.TotalSum);
        return NoContent();
    }

    [HttpGet("inshares")]
    public async Task<ActionResult<InSharesRequest>> GetInShares()
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var inShares = await _users.GetInSharesAsync(userId);
        return Ok(new InSharesRequest((double)inShares));
    }

    [HttpPut("inshares")]
    public async Task<IActionResult> UpdateInShares([FromBody] InSharesRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        await _users.UpdateInSharesAsync(userId, request.InShares);
        return NoContent();
    }
}




