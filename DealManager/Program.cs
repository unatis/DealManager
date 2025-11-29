using Microsoft.AspNetCore.HttpOverrides;

internal class Program
{
    private static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Add services
        builder.Services.AddControllers();
        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen();

        // Bind to Render's port for render
        //var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
        //builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

        // Configure forwarded headers to respect X-Forwarded-Proto/X-Forwarded-For
        builder.Services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;

            // Optional: tighten security by specifying known proxies or networks, e.g.:
            // options.KnownProxies.Add(IPAddress.Parse("1.2.3.4"));
        });

        var app = builder.Build();

        // Must run before UseHttpsRedirection() and anything that depends on scheme
        app.UseForwardedHeaders();

        // Enable HTTPS redirection (now correctly detects original scheme)
        app.UseHttpsRedirection();

        // Static files: default files must be registered before static files
        app.UseDefaultFiles();
        app.UseStaticFiles();

        app.UseAuthorization();

        app.MapControllers();

        app.Run();
    }
}