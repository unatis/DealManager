namespace DealManager.Services
{
    public interface IRiskService
    {
        Task<decimal> CalculatePortfolioRiskPercentAsync(string userId);
        Task<decimal> CalculateInSharesRiskPercentAsync(string userId);

        /// <summary>
        /// Рассчитывает лимиты для новой/обновляемой сделки исходя из размера портфеля,
        /// доступного кэша, текущего суммарного риска и стоп-лосса сделки.
        /// </summary>
        Task<DealLimitResult> CalculateDealLimitsAsync(string userId, decimal stopLossPercent);
    }

    public record DealLimitResult(
        decimal MaxPosition,        // максимально допустимая позиция (обе стадии вместе)
        decimal MaxStage1,          // максимум первой стадии (обычно 50% от MaxPosition)
        decimal RecommendedStage1,  // рекомендованный размер первой стадии
        decimal RecommendedStage2,  // рекомендованный размер второй стадии
        decimal AddedRiskPercent,   // сколько % риска добавит MaxPosition к портфелю
        decimal SingleStageMax,     // максимум для одноэтапной сделки
        bool   Allowed              // не превышает ли суммарный риск портфеля лимит
    );
}
