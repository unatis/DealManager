using DealManager;
using DealManager.Models;
using DealManager.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly UsersService _users;
    private readonly JwtSettings _jwt;
    private readonly PasswordHasher<AppUser> _hasher = new();

    public AuthController(UsersService users, IOptions<JwtSettings> jwtOptions)
    {
        _users = users;
        _jwt = jwtOptions.Value;
    }

    public record RegisterRequest(string Email, string Password);
    public record LoginRequest(string Email, string Password);

    // ТРИ ПАРАМЕТРА: Token, Email, Portfolio
    public record AuthResponse(string Token, string Email, double Portfolio);

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req)
    {
        var existing = await _users.GetByEmailAsync(req.Email);
        if (existing != null)
            return Conflict("User with this email already exists");

        var user = new AppUser
        {
            Email = req.Email,
            Portfolio = 0.0       // стартовое значение
        };

        user.PasswordHash = _hasher.HashPassword(user, req.Password);
        await _users.CreateAsync(user);

        var token = GenerateJwt(user);
        // <-- добавили user.Portfolio
        return new AuthResponse(token, user.Email, user.Portfolio);
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var user = await _users.GetByEmailAsync(req.Email);
        if (user == null)
            return Unauthorized("Invalid email or password");

        var result = _hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password);
        if (result == PasswordVerificationResult.Failed)
            return Unauthorized("Invalid email or password");

        var token = GenerateJwt(user);
        // <-- добавили user.Portfolio
        return new AuthResponse(token, user.Email, user.Portfolio);
    }

    private string GenerateJwt(AppUser user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.Key));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id ?? ""),
            new Claim(JwtRegisteredClaimNames.Email, user.Email),
        };

        var token = new JwtSecurityToken(
            issuer: _jwt.Issuer,
            audience: _jwt.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(_jwt.ExpiresMinutes),
            signingCredentials: creds);

        var jwt = new JwtSecurityTokenHandler().WriteToken(token);

        Console.WriteLine($"JWT generated for {user.Email}: {jwt}");

        return jwt;
    }
}
