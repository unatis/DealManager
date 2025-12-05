using DealManager.Models;

namespace DealManager.Services;

public static class BetaService
{
    /// <summary>
    /// Считает бету и корреляцию акции к бенчмарку (например, SPY)
    /// по недельным свечам.
    ///
    /// 1. Выравнивает ряды по общим датам.
    /// 2. Строит недельные лог-доходности по Close.
    /// 3. Считает ковариацию, дисперсию и корреляцию.
    /// </summary>
    public static BetaCorrelationResult CalculateBetaAndCorrelation(
        IReadOnlyList<WeeklyCandle> assetCandles,
        IReadOnlyList<WeeklyCandle> benchmarkCandles)
    {
        if (assetCandles == null) throw new ArgumentNullException(nameof(assetCandles));
        if (benchmarkCandles == null) throw new ArgumentNullException(nameof(benchmarkCandles));

        // 1. Сортируем по дате
        var asset = assetCandles
            .OrderBy(c => c.Date)
            .ToList();

        var bench = benchmarkCandles
            .OrderBy(c => c.Date)
            .ToList();

        // 2. Выравниваем ряды по общим датам (merge join по Date.Date)
        var alignedAssetCloses = new List<double>();
        var alignedBenchCloses = new List<double>();

        int i = 0, j = 0;
        while (i < asset.Count && j < bench.Count)
        {
            var da = asset[i].Date.Date;
            var db = bench[j].Date.Date;

            if (da == db)
            {
                alignedAssetCloses.Add((double)asset[i].Close);
                alignedBenchCloses.Add((double)bench[j].Close);
                i++;
                j++;
            }
            else if (da < db)
            {
                i++;
            }
            else
            {
                j++;
            }
        }

        if (alignedAssetCloses.Count < 3)
            throw new InvalidOperationException("Недостаточно общих недель для расчёта беты и корреляции (нужно минимум 3 точки).");

        // 3. Строим недельные лог-доходности
        var assetReturns = new List<double>();
        var benchReturns = new List<double>();

        for (int k = 1; k < alignedAssetCloses.Count; k++)
        {
            double prevA = alignedAssetCloses[k - 1];
            double currA = alignedAssetCloses[k];
            double prevB = alignedBenchCloses[k - 1];
            double currB = alignedBenchCloses[k];

            if (prevA <= 0 || prevB <= 0)
                continue; // пропускаем кривые данные

            double rA = Math.Log(currA / prevA);
            double rB = Math.Log(currB / prevB);

            assetReturns.Add(rA);
            benchReturns.Add(rB);
        }

        if (assetReturns.Count < 2)
            throw new InvalidOperationException("Недостаточно валидных доходностей для расчёта.");

        int n = assetReturns.Count;

        // 4. Средние доходности
        double meanA = assetReturns.Average();
        double meanB = benchReturns.Average();

        // 5. Ковариация и дисперсия бенчмарка
        double covAB = 0.0;
        double varB = 0.0;
        double varA = 0.0;

        for (int k = 0; k < n; k++)
        {
            double da = assetReturns[k] - meanA;
            double db = benchReturns[k] - meanB;

            covAB += da * db;
            varB += db * db;
            varA += da * da;
        }

        // Несмещённые оценки (делим на n - 1)
        covAB /= (n - 1);
        varB /= (n - 1);
        varA /= (n - 1);

        if (varB == 0.0)
            throw new InvalidOperationException("Дисперсия бенчмарка равна нулю, бету посчитать нельзя.");

        double beta = covAB / varB;

        // 6. Корреляция: cov / (σA * σB)
        double stdA = Math.Sqrt(varA);
        double stdB = Math.Sqrt(varB);

        double correlation = (stdA == 0 || stdB == 0)
            ? 0.0
            : covAB / (stdA * stdB);

        return new BetaCorrelationResult(
            Beta: beta,
            Correlation: correlation,
            PointsUsed: n   // столько недельных доходностей использовано
        );
    }

    /// <summary>
    /// Конвертирует PricePoint в WeeklyCandle (для совместимости с существующими данными)
    /// </summary>
    public static WeeklyCandle ToWeeklyCandle(PricePoint pricePoint)
    {
        return new WeeklyCandle
        {
            Date = pricePoint.Date,
            Open = pricePoint.Open,
            High = pricePoint.High,
            Low = pricePoint.Low,
            Close = pricePoint.Close
        };
    }

    /// <summary>
    /// Конвертирует список PricePoint в список WeeklyCandle
    /// </summary>
    public static IReadOnlyList<WeeklyCandle> ToWeeklyCandles(IReadOnlyList<PricePoint> pricePoints)
    {
        return pricePoints.Select(ToWeeklyCandle).ToList().AsReadOnly();
    }
}


