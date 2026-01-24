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
        builder.Services.AddSingleton<UsersService>();
        builder.Services.AddSingleton<StocksService>();
        builder.Services.AddSingleton<PinnedStocksService>();
        builder.Services.AddSingleton<WarningsService>();
        builder.Services.AddSingleton<IRiskService, RiskService>();
        builder.Services.AddSingleton<DealsService>();
        builder.Services.AddSingleton<TrendAnalyzer>();
        builder.Services.AddSingleton<AiChatHistoryService>();

        // ---------- AI settings ----------
        // Load defaults from appsettings (Ai section) and override from environment variables (Render).
        var aiSettings = builder.Configuration.GetSection("Ai").Get<AiSettings>() ?? new AiSettings();
        aiSettings.Provider = Environment.GetEnvironmentVariable("AI_PROVIDER") ?? aiSettings.Provider;
        aiSettings.Model = Environment.GetEnvironmentVariable("AI_MODEL") ?? aiSettings.Model;

        // Key is read from:
        // - User Secrets (local dev): Ai:GroqApiKey
        // - Environment variables (Render/prod): GROQ_API_KEY (has priority if set)
        var envGroqKey = Environment.GetEnvironmentVariable("GROQ_API_KEY");
        if (!string.IsNullOrWhiteSpace(envGroqKey))
        {
            aiSettings.GroqApiKey = envGroqKey;
        }
        aiSettings.Temperature = double.TryParse(Environment.GetEnvironmentVariable("AI_TEMPERATURE"), out var t)
            ? t
            : aiSettings.Temperature;

        builder.Services.AddSingleton(aiSettings);
        builder.Services.AddHttpClient<GroqChatClient>();

        // ---------- JWT settings ----------
        var jwtSection = builder.Configuration.GetSection("Jwt");
        builder.Services.Configure<JwtSettings>(jwtSection);

        var jwtSettings = jwtSection.Get<JwtSettings>()?? throw new InvalidOperationException("Jwt configuration section is missing");
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

        builder.Services.Configure<AlphaVantageSettings>(
        builder.Configuration.GetSection("AlphaVantage"));

        builder.Services.Configure<MarketstackSettings>(
        builder.Configuration.GetSection("Marketstack"));

        builder.Services.AddMemoryCache();
        builder.Services.AddHttpClient<AlphaVantageService>();
        builder.Services.AddHttpClient<MarketstackService>();

        // Register background service for SPY data fetch on startup
        builder.Services.AddHostedService<SpyDataBackgroundService>();

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

        builder.Services.AddHttpClient();

        var app = builder.Build();

        app.UseForwardedHeaders();
        app.UseHttpsRedirection();
        app.UseDefaultFiles();
        app.UseStaticFiles();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();

        app.Run();
    }
}
