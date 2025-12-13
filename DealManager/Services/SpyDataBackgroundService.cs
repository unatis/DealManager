using DealManager.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace DealManager.Services
{
    public class SpyDataBackgroundService : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<SpyDataBackgroundService> _logger;

        public SpyDataBackgroundService(
            IServiceProvider serviceProvider,
            ILogger<SpyDataBackgroundService> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            // Wait a bit for the application to fully start
            await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);

            try
            {
                _logger.LogInformation("Starting SPY data fetch background service");
                
                using var scope = _serviceProvider.CreateScope();
                var alphaVantageService = scope.ServiceProvider.GetRequiredService<AlphaVantageService>();
                
                await alphaVantageService.FetchSpyWeeklyDataAsync();
                
                _logger.LogInformation("SPY data fetch completed successfully");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to fetch SPY data in background service: {Message}", ex.Message);
            }
        }
    }
}











