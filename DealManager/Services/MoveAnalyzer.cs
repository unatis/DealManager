using System;
using System.Collections.Generic;
using System.Linq;
using DealManager.Models;

namespace DealManager.Services
{
    /// <summary>
    /// Нормализованные метрики движения
    /// относительно истории за заданный период (lookback).
    /// </summary>
    public record NormalizedMoveMetrics(
        int Direction,          // -1 = вниз, 0 = флэт, 1 = вверх
        double ReturnPct,       // чистый ход последнего бара в %
        double SpeedPct,        // скорость в % от макс. в этом направлении
        double StrengthPct,     // сила (|ΔP| * Volume) в % от макс.
        double EaseOfMovePct    // лёгкость (ход / объём) в % от макс.
    );

    /// <summary>
    /// Композитный индекс движения.
    /// </summary>
    public record MovementScore(
        double MagnitudePct,    // сила по модулю, %
        double SignedPct        // с направлением: <0 вниз, >0 вверх
    );

    public static class MoveAnalyzer
    {
        /// <summary>
        /// Считает метрики для одного периода lookbackBars.
        /// bars – история (последний бар = "подопытный").
        /// Последний бар НЕ учитывается в статистике (максимумы только по истории).
        /// </summary>
        public static NormalizedMoveMetrics CalculateNormalizedMoveMetricsForPeriod(
            IReadOnlyList<PricePoint> bars,
            int lookbackBars,
            double flatThresholdPct = 0.001) // 0.1% порог для флэта
        {
            if (bars == null) throw new ArgumentNullException(nameof(bars));
            if (lookbackBars < 2) throw new ArgumentOutOfRangeException(nameof(lookbackBars));

            var ordered = bars
                .OrderBy(b => b.Date)
                .ToList();

            // Нужны: lookbackBars исторических баров + 1 последний ("подопытный")
            // => минимум lookbackBars + 1 бар в сумме.
            if (ordered.Count < lookbackBars + 1)
                throw new ArgumentException(
                    $"Нужно минимум {lookbackBars + 1} баров для lookback={lookbackBars}.",
                    nameof(bars));

            // Берём хвост: lookbackBars исторических + 1 текущий
            var slice = ordered
                .Skip(ordered.Count - (lookbackBars + 1))
                .ToList();

            int m = slice.Count; // m = lookbackBars + 1
            int lastIndex = m - 1; // индекс последнего бара

            var returns   = new double[m]; // r[i] = (Close[i] / Close[i-1]) - 1
            var strengths = new double[m]; // |r| * Volume
            var volumes   = new double[m]; // Volume

            // 1. Считаем доходности и силы движений
            for (int i = 1; i < m; i++)
            {
                double prevClose = (double)slice[i - 1].Close;
                double currClose = (double)slice[i].Close;
                long volume      = slice[i].Volume;

                if (prevClose <= 0)
                    continue;

                double r    = (currClose - prevClose) / prevClose; // в долях
                double absR = Math.Abs(r);

                returns[i]   = r;
                strengths[i] = absR * volume;
                volumes[i]   = volume;
            }

            double lastReturn   = returns[lastIndex];
            double lastAbsRet   = Math.Abs(lastReturn);
            double lastVolume   = volumes[lastIndex];
            double lastStrength = strengths[lastIndex];

            // 2. Средний объём по истории (без последнего бара)
            var histVolumes = volumes
                .Skip(1)                  // игнорируем нулевой (для него нет return)
                .Take(lastIndex - 1)      // 1..lastIndex-1 (без последнего)
                .Where(v => v > 0)
                .ToList();

            double avgVolume = histVolumes.Count > 0
                ? histVolumes.Average()
                : lastVolume; // fallback, если вдруг нет истории

            // 3. Считаем "лёгкость" движения (ease) по всем барам
            var ease = new double[m];

            for (int i = 1; i < m; i++)
            {
                double r    = returns[i];
                double absR = Math.Abs(r);
                double vol  = volumes[i];

                if (avgVolume > 0 && vol > 0)
                {
                    double volumeFactor = vol / avgVolume; // относительный объём
                    ease[i] = volumeFactor > 0
                        ? absR / volumeFactor // большой ход при малом объёме → высокий ease
                        : 0.0;
                }
                else
                {
                    ease[i] = 0.0;
                }
            }

            double lastEase = ease[lastIndex];

            // 4. Находим максимумы по истории (1..lastIndex-1), без последнего бара
            double maxUpSpeed        = 0.0;
            double maxDownSpeed      = 0.0;
            double maxUpStrength     = 0.0;
            double maxDownStrength   = 0.0;
            double maxUpEase         = 0.0;
            double maxDownEase       = 0.0;

            for (int i = 1; i < lastIndex; i++)
            {
                double r    = returns[i];
                double absR = Math.Abs(r);
                double s    = strengths[i];
                double e    = ease[i];

                if (r > 0)
                {
                    if (absR > maxUpSpeed)      maxUpSpeed      = absR;
                    if (s    > maxUpStrength)   maxUpStrength   = s;
                    if (e    > maxUpEase)       maxUpEase       = e;
                }
                else if (r < 0)
                {
                    if (absR > maxDownSpeed)    maxDownSpeed    = absR;
                    if (s    > maxDownStrength) maxDownStrength = s;
                    if (e    > maxDownEase)     maxDownEase     = e;
                }
            }

            // -------------------- FLAT DETECTION (сближение с карточкой) --------------------
            // Порог, когда один бар сам по себе считается "незначительным"
            double flatBarThreshold = 0.003; // 0.3%

            // Допуск для сравнения high/low/open/close (как в карточке)
            decimal tol = 0.1m;

            // Флет: диапазон Open/Close последней недели внутри диапазона предыдущей,
            // а диапазон предыдущей внутри диапазона третьей (oldest).
            bool structuralFlat = false;
            var last3 = slice.Skip(Math.Max(0, slice.Count - 3)).ToList();
            if (last3.Count == 3)
            {
                var oldest = last3[0];
                var mid = last3[1];
                var latest = last3[2];

                decimal oldMin = Math.Min(oldest.Open, oldest.Close);
                decimal oldMax = Math.Max(oldest.Open, oldest.Close);

                decimal midMin = Math.Min(mid.Open, mid.Close);
                decimal midMax = Math.Max(mid.Open, mid.Close);

                decimal lastMin = Math.Min(latest.Open, latest.Close);
                decimal lastMax = Math.Max(latest.Open, latest.Close);

                bool midInsideOld = midMin >= oldMin && midMax <= oldMax;
                bool lastInsideMid = lastMin >= midMin && lastMax <= midMax;

                structuralFlat = midInsideOld && lastInsideMid;
            }

            // Кластер по диапазону закрытий, но теперь на 3 бара
            bool isFlatCluster = IsFlatCluster(
                slice,
                lastIndex,
                flatWindowBars: 3,            // последние 3 бара
                flatRangePctThreshold: 0.02,  // весь диапазон < 2%
                flatWindowRetThreshold: 0.01  // общий ход < 1%
            );

            var last3Lows = slice.Skip(Math.Max(0, slice.Count - 3)).ToList();
            bool has3 = last3Lows.Count == 3;
            decimal lowOld = has3 ? last3Lows[0].Low : 0m;
            decimal lowMid = has3 ? last3Lows[1].Low : 0m;
            decimal lowLast = has3 ? last3Lows[2].Low : 0m;

            // 5. Определяем направление
            int direction;

            if (structuralFlat && isFlatCluster && Math.Abs(lastReturn) < flatBarThreshold)
            {
                // Флэт: структура по high/low/open/close + узкий диапазон по close + маленький бар
                direction = 0;
            }
            else if (has3 && lowLast > lowMid && lowMid > lowOld)
            {
                direction = 1;
            }
            else if (has3 && lowLast < lowMid && lowMid < lowOld)
            {
                direction = -1;
            }
            else
            {
                // Fallback: use last bar return if not enough bars or no clear 3-low trend
                if (lastReturn > flatBarThreshold) direction = 1;
                else if (lastReturn < -flatBarThreshold) direction = -1;
                else direction = 0;
            }

            // 6. Нормализация в % относительно максимумов (значения могут быть >100%)
            double speedPct      = 0.0;
            double strengthPct   = 0.0;
            double easeOfMovePct = 0.0;

            if (direction > 0) // вверх
            {
                speedPct = maxUpSpeed > 0
                    ? lastAbsRet / maxUpSpeed * 100.0
                    : 100.0; // первый ап-движ, истории вверх нет

                strengthPct = maxUpStrength > 0
                    ? lastStrength / maxUpStrength * 100.0
                    : 100.0;

                easeOfMovePct = maxUpEase > 0
                    ? lastEase / maxUpEase * 100.0
                    : 100.0;
            }
            else if (direction < 0) // вниз
            {
                speedPct = maxDownSpeed > 0
                    ? lastAbsRet / maxDownSpeed * 100.0
                    : 100.0;

                strengthPct = maxDownStrength > 0
                    ? lastStrength / maxDownStrength * 100.0
                    : 100.0;

                easeOfMovePct = maxDownEase > 0
                    ? lastEase / maxDownEase * 100.0
                    : 100.0;
            }
            // если direction == 0 → всё остаётся 0

            double returnPct = lastReturn * 100.0;

            return new NormalizedMoveMetrics(
                Direction: direction,
                ReturnPct: returnPct,
                SpeedPct: speedPct,
                StrengthPct: strengthPct,
                EaseOfMovePct: easeOfMovePct
            );
        }

        /// <summary>
        /// Определяет, является ли окно баров флэт-кластером.
        /// </summary>
        private static bool IsFlatCluster(
            IReadOnlyList<PricePoint> bars,
            int lastIndex,
            int flatWindowBars = 4,
            double flatRangePctThreshold = 0.02,   // диапазон < 2%
            double flatWindowRetThreshold = 0.01)  // суммарный ход < 1%
        {
            if (lastIndex <= 0 || bars.Count == 0)
                return false;

            flatWindowBars = Math.Max(2, flatWindowBars);
            int start = Math.Max(0, lastIndex - (flatWindowBars - 1));
            var window = bars
                .Skip(start)
                .Take(lastIndex - start + 1)
                .ToList();

            if (window.Count < 2)
                return false;

            double minClose   = (double)window.Min(b => b.Close);
            double maxClose   = (double)window.Max(b => b.Close);
            double firstClose = (double)window.First().Close;
            double lastClose  = (double)window.Last().Close;

            double midPrice = (minClose + maxClose) / 2.0;

            double rangePct = midPrice > 0
                ? (maxClose - minClose) / midPrice     // ширина диапазона
                : 0.0;

            double windowRet = firstClose > 0
                ? (lastClose - firstClose) / firstClose // общий ход окна
                : 0.0;

            return Math.Abs(windowRet) <= flatWindowRetThreshold &&
                   rangePct           <= flatRangePctThreshold;
        }

        /// <summary>
        /// Считает метрики для нескольких периодов lookback.
        /// Например periods = { 26, 52, 104 } для недельных баров:
        /// полгода, год, 2 года.
        /// </summary>
        public static IDictionary<int, NormalizedMoveMetrics> CalculateNormalizedMoveMetricsForPeriods(
            IReadOnlyList<PricePoint> bars,
            IEnumerable<int> periods,
            double flatThresholdPct = 0.001)
        {
            if (bars == null) throw new ArgumentNullException(nameof(bars));
            if (periods == null) throw new ArgumentNullException(nameof(periods));

            var result = new Dictionary<int, NormalizedMoveMetrics>();

            foreach (var p in periods.Distinct().OrderBy(x => x))
            {
                if (p < 2)
                    continue;

                var metrics = CalculateNormalizedMoveMetricsForPeriod(
                    bars,
                    lookbackBars: p,
                    flatThresholdPct: flatThresholdPct);

                result[p] = metrics;
            }

            return result;
        }
    }

    public static class MoveScoreCombiner
    {
        /// <summary>
        /// Склеивает Speed/Strength/Ease в один показатель.
        /// Возвращает:
        /// - MagnitudePct: сила по модулю (0..100+)
        /// - SignedPct: с направлением (<0 вниз, >0 вверх)
        /// </summary>
        public static MovementScore Combine(
            NormalizedMoveMetrics m,
            double wSpeed = 2.0,
            double wStrength = 3.0,
            double wEase = 1.0,
            bool clampTo100 = false)
        {
            double speed    = Math.Max(0.0, m.SpeedPct);
            double strength = Math.Max(0.0, m.StrengthPct);
            double ease     = Math.Max(0.0, m.EaseOfMovePct);

            double weightSum = wSpeed + wStrength + wEase;
            if (weightSum <= 0)
                throw new ArgumentException("Сумма весов должна быть > 0.");

            double magnitude = (wSpeed * speed + wStrength * strength + wEase * ease) / weightSum;

            if (clampTo100)
            {
                // Если хочешь жёстко ограничить сверху:
                magnitude = Math.Min(magnitude, 100.0);
            }

            int dir = m.Direction; // -1, 0, 1
            double signed = magnitude * dir;

            return new MovementScore(
                MagnitudePct: magnitude,
                SignedPct: signed
            );
        }
    }
}

