using System.Text;
using DealManager;
using DealManager.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;

internal class Program
{
    private static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // ---------- Mongo settings ----------
        var mongoSection = builder.Configuration.GetSection("Mongo");
        var mongoSettings = mongoSection.Get<MongoSettings>() ?? new MongoSettings();

        // Если есть переменная окружения MONGODB_URI – используем её
        var uriFromEnv = Environment.GetEnvironmentVariable("MONGODB_URI");
        if (!string.IsNullOrWhiteSpace(uriFromEnv))
        {
            mongoSettings.ConnectionString = uriFromEnv;
        }

        builder.Services.AddSingleton(mongoSettings);
        builder.Services.AddSingleton<DealsService>();
        builder.Services.AddSingleton<UsersService>();
        builder.Services.AddSingleton<StocksService>();

        // ---------- JWT settings ----------
        var jwtSection = builder.Configuration.GetSection("Jwt");
        builder.Services.Configure<JwtSettings>(jwtSection);

        var jwtSettings = jwtSection.Get<JwtSettings>()
                          ?? throw new InvalidOperationException("Jwt configuration section is missing");

        var key = Encoding.UTF8.GetBytes(jwtSettings.Key);

        builder.Services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    // нормальная строгая проверка
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateIssuerSigningKey = true,
                    ValidateLifetime = true,

                    ValidIssuer = jwtSettings.Issuer,
                    ValidAudience = jwtSettings.Audience,
                    IssuerSigningKey = new SymmetricSecurityKey(key),
                    ClockSkew = TimeSpan.FromMinutes(2)
                };

                options.Events = new JwtBearerEvents
                {
                    OnAuthenticationFailed = ctx =>
                    {
                        Console.WriteLine("JWT auth failed: " + ctx.Exception);
                        return Task.CompletedTask;
                    }
                };
            });

        builder.Services.AddAuthorization();

        builder.Services.AddControllers();
        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen();

        // ---------- Forwarded headers (Render / прокси) ----------
        builder.Services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders =
                ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        });

        var app = builder.Build();

        app.UseForwardedHeaders();

        app.UseHttpsRedirection();

        // статика (index.html, login.html, css, js)
        app.UseDefaultFiles();
        app.UseStaticFiles();

        app.UseAuthentication();
        app.UseAuthorization();

        app.MapControllers();

        app.Run();
    }
}
