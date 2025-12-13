namespace DealManager.Services;

public static class VolatilityCategory
{
    /// <summary>
    /// Возвращает категорию волатильности по бете:
    /// 1 = Slow (меньше рынка),
    /// 2 = Same (примерно как рынок),
    /// 3 = High (более волатильная).
    /// </summary>
    public static int FromBeta(double beta)
    {
        if (double.IsNaN(beta) || double.IsInfinity(beta))
            throw new ArgumentException("Некорректное значение беты.", nameof(beta));

        if (beta < 0.8)
            return 1; // Slow

        if (beta <= 1.2)
            return 2; // Same (around market)

        return 3;     // High (more volatile)
    }
}










