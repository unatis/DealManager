namespace DealManager.Services
{
    public interface IRiskService
    {
        Task<decimal> CalculatePortfolioRiskPercentAsync(string userId);
        Task<decimal> CalculateInSharesRiskPercentAsync(string userId);
    }
}




