using System;
using System.Collections.Generic;
using System.Linq;
using DealManager.Models;

namespace DealManager.Services
{
    public class TrendAnalyzer
    {
        public enum TrendWeeks
        {
            Flat,
            Up,
            Down
        }

        public enum TrendMonthes
        {
            Flat,
            Up,
            Down
        }

        public enum TrendDays
        {
            Flat,
            Up,
            Down
        }

        private readonly decimal _defaultTolerance;

        public TrendAnalyzer(decimal defaultTolerance = 0.1m)
        {
            _defaultTolerance = defaultTolerance;
        }

        /// <summary>
        /// Общая логика определения тренда по минимумам (Low).
        ///  1  - восходящий тренд
        /// -1  - нисходящий тренд
        ///  0  - флет / нет однозначного направления
        /// </summary>
        private int DetectTrendByLowsCore(
            IReadOnlyList<PricePoint> points,
            int periods,
            decimal? tolerance = null)
        {
            if (points == null || points.Count < 2)
                return 0;

            var tol = tolerance ?? _defaultTolerance;

            // Берём последние N точек, но не меньше 2 и не больше фактического количества
            var count = Math.Min(Math.Max(periods, 2), points.Count);
            int startIndex = points.Count - count;

            bool anyUp = false;
            bool anyDown = false;

            for (int i = startIndex + 1; i < points.Count; i++)
            {
                if (i - 1 < 0 || i >= points.Count)
                    continue;
                    
                var prevPoint = points[i - 1];
                var currPoint = points[i];
                
                if (prevPoint == null || currPoint == null)
                    continue;

                var prevLow = prevPoint.Low;
                var currLow = currPoint.Low;
                var diff = currLow - prevLow;

                // Игнорируем мелкие колебания
                if (Math.Abs(diff) <= tol)
                    continue;

                if (diff > 0)
                    anyUp = true;
                else
                    anyDown = true;
            }

            if (anyUp && !anyDown) return 1;
            if (anyDown && !anyUp) return -1;
            return 0;
        }

        // ---------- НЕДЕЛИ ----------

        public TrendWeeks DetectTrendByLowsForWeeks(
            IReadOnlyList<PricePoint> points,
            int weeks = 4,
            decimal? tolerance = null)
        {
            if (points == null || points.Count < 2)
                return TrendWeeks.Flat;

            var ordered = points
                .OrderBy(p => p.Date)
                .ToList();

            int sign = DetectTrendByLowsCore(ordered, weeks, tolerance);

            if (sign > 0) return TrendWeeks.Up;
            if (sign < 0) return TrendWeeks.Down;
            return TrendWeeks.Flat;
        }

        // если используешь PriceSeriesDto
        public TrendWeeks DetectTrendByLowsForWeeks(
            PriceSeriesDto series,
            int weeks = 4,
            decimal? tolerance = null)
        {
            if (series == null)
                return TrendWeeks.Flat;

            return DetectTrendByLowsForWeeks(series.Points, weeks, tolerance);
        }

        // ---------- МЕСЯЦЫ ----------

        public TrendMonthes DetectTrendByLowsForMonths(
            IReadOnlyList<PricePoint> points,
            int months = 3,
            decimal? tolerance = null)
        {
            if (points == null || points.Count < 2)
                return TrendMonthes.Flat;

            var ordered = points
                .OrderBy(p => p.Date)
                .ToList();

            int sign = DetectTrendByLowsCore(ordered, months, tolerance);

            if (sign > 0) return TrendMonthes.Up;
            if (sign < 0) return TrendMonthes.Down;
            return TrendMonthes.Flat;
        }

        public TrendMonthes DetectTrendByLowsForMonths(
            PriceSeriesDto series,
            int months = 3,
            decimal? tolerance = null)
        {
            if (series == null)
                return TrendMonthes.Flat;

            return DetectTrendByLowsForMonths(series.Points, months, tolerance);
        }

        // ---------- ДНИ ----------

        public TrendDays DetectTrendByLowsForDays(
            IReadOnlyList<PricePoint> points,
            int days = 10,
            decimal? tolerance = null)
        {
            if (points == null || points.Count < 2)
                return TrendDays.Flat;

            var ordered = points
                .OrderBy(p => p.Date)
                .ToList();

            int sign = DetectTrendByLowsCore(ordered, days, tolerance);

            if (sign > 0) return TrendDays.Up;
            if (sign < 0) return TrendDays.Down;
            return TrendDays.Flat;
        }

        public TrendDays DetectTrendByLowsForDays(
            PriceSeriesDto series,
            int days = 10,
            decimal? tolerance = null)
        {
            if (series == null)
                return TrendDays.Flat;

            return DetectTrendByLowsForDays(series.Points, days, tolerance);
        }

        public IReadOnlyList<SupportResistanceLevel> DetectSupportResistanceLevels(
    IReadOnlyList<PricePoint> points,
    int minHighTouches = 1,
    int minLowTouches = 1,
    int minTotalTouches = 3,
    int maxLevels = 10)
        {
            if (points == null || points.Count == 0)
                return Array.Empty<SupportResistanceLevel>();

            // Собираем хай/лоу вместе с датами
            var highs = points
                .Select(p => (price: p.High, date: p.Date))
                .ToList();

            var lows = points
                .Select(p => (price: p.Low, date: p.Date))
                .ToList();

            var allPrices = highs.Select(h => h.price)
                .Concat(lows.Select(l => l.price))
                .OrderBy(v => v)
                .ToList();

            if (allPrices.Count == 0)
                return Array.Empty<SupportResistanceLevel>();

            // Соседние разности -> медиана = типичный шаг
            var diffs = new List<decimal>();
            for (int i = 0; i < allPrices.Count - 1; i++)
            {
                var diff = allPrices[i + 1] - allPrices[i];
                if (diff > 0)
                    diffs.Add(diff);
            }

            if (diffs.Count == 0)
            {
                // Все цены примерно одинаковые -> один уровень
                var onlyLevel = allPrices[0];

                var touches = points
                    .Where(p => p.High == onlyLevel || p.Low == onlyLevel)
                    .ToList();

                return new[]
                {
            new SupportResistanceLevel
            {
                Level      = onlyLevel,
                LowBound   = onlyLevel,
                HighBound  = onlyLevel,
                HighTouches = touches.Count(p => p.High == onlyLevel),
                LowTouches  = touches.Count(p => p.Low == onlyLevel),
                FirstTouch  = touches.Min(p => p.Date),
                LastTouch   = touches.Max(p => p.Date)
            }
        };
            }

            diffs.Sort();
            decimal medianDiff;
            int mid = diffs.Count / 2;
            if (diffs.Count % 2 == 0)
                medianDiff = (diffs[mid - 1] + diffs[mid]) / 2m;
            else
                medianDiff = diffs[mid];

            if (medianDiff <= 0)
                medianDiff = diffs[0];

            var threshold = medianDiff; // авто-порог по данным

            // Строим кластеры по allPrices
            var clusterBounds = new List<(decimal low, decimal high)>();
            decimal clusterLow = allPrices[0];
            decimal clusterHigh = allPrices[0];

            for (int i = 1; i < allPrices.Count; i++)
            {
                var price = allPrices[i];
                var gap = price - clusterHigh;

                if (gap <= threshold)
                {
                    // продолжаем кластер
                    clusterHigh = price;
                }
                else
                {
                    // закрываем текущий кластер
                    clusterBounds.Add((clusterLow, clusterHigh));
                    // начинаем новый
                    clusterLow = clusterHigh = price;
                }
            }

            // последний кластер
            clusterBounds.Add((clusterLow, clusterHigh));

            var levels = new List<SupportResistanceLevel>();

            foreach (var (lowBound, highBound) in clusterBounds)
            {
                // сколько хай/лоу попадает в этот диапазон
                var highTouchesList = highs
                    .Where(h => h.price >= lowBound && h.price <= highBound)
                    .ToList();

                var lowTouchesList = lows
                    .Where(l => l.price >= lowBound && l.price <= highBound)
                    .ToList();

                int highTouches = highTouchesList.Count;
                int lowTouches = lowTouchesList.Count;
                int totalTouches = highTouches + lowTouches;

                // интересуют только уровни, где есть и high, и low,
                // и достаточно касаний
                if (highTouches < minHighTouches ||
                    lowTouches < minLowTouches ||
                    totalTouches < minTotalTouches)
                {
                    continue;
                }

                // все цены внутри кластера
                var clusterValues = allPrices
                    .Where(v => v >= lowBound && v <= highBound)
                    .ToList();

                if (clusterValues.Count == 0)
                    continue;

                var levelPrice = clusterValues.Average();

                var allTouchDates = highTouchesList
                    .Select(h => h.date)
                    .Concat(lowTouchesList.Select(l => l.date))
                    .ToList();

                levels.Add(new SupportResistanceLevel
                {
                    Level = levelPrice,
                    LowBound = lowBound,
                    HighBound = highBound,
                    HighTouches = highTouches,
                    LowTouches = lowTouches,
                    FirstTouch = allTouchDates.Min(),
                    LastTouch = allTouchDates.Max()
                });
            }

            // сортируем по "силе": сначала по числу касаний, потом по свежести
            var ordered = levels
                .OrderByDescending(l => l.TotalTouches)
                .ThenByDescending(l => l.LastTouch)
                .ToList();

            if (maxLevels > 0 && ordered.Count > maxLevels)
                ordered = ordered.Take(maxLevels).ToList();

            // для удобства отображения можно отсортировать по цене:
            // ordered = ordered.OrderBy(l => l.Level).ToList();

            return ordered;
        }

        /// <summary>
        /// Находит уровни, которые одновременно выступают как поддержка/сопротивление:
        /// кластеры цен, где есть и High, и Low и достаточно касаний.
        /// Возвращает уровни как среднее значение по кластеру.
        /// </summary>
        /// <param name="points">Коллекция свечей</param>
        /// <param name="minHighTouches">минимальное число касаний high в кластере</param>
        /// <param name="minLowTouches">минимальное число касаний low в кластере</param>
        /// <param name="minTotalTouches">минимальное общее число касаний (high+low)</param>
        //public IReadOnlyList<decimal> DetectSupportResistanceLevels(
        //    IReadOnlyList<PricePoint> points,
        //    int minHighTouches = 1,
        //    int minLowTouches = 1,
        //    int minTotalTouches = 3)
        //{
        //    if (points == null || points.Count == 0)
        //        return Array.Empty<decimal>();

        //    var highs = points.Select(p => p.High).ToList();
        //    var lows = points.Select(p => p.Low).ToList();

        //    var allPrices = highs
        //        .Concat(lows)
        //        .OrderBy(v => v)
        //        .ToList();

        //    if (allPrices.Count == 0)
        //        return Array.Empty<decimal>();

        //    // Считаем соседние разности и берём медиану как типичный шаг
        //    var diffs = new List<decimal>();
        //    for (int i = 0; i < allPrices.Count - 1; i++)
        //    {
        //        var diff = allPrices[i + 1] - allPrices[i];
        //        if (diff > 0)
        //            diffs.Add(diff);
        //    }

        //    if (diffs.Count == 0)
        //    {
        //        // Все цены одинаковые -> один уровень
        //        return new[] { allPrices[0] };
        //    }

        //    diffs.Sort();
        //    decimal medianDiff;
        //    int mid = diffs.Count / 2;
        //    if (diffs.Count % 2 == 0)
        //        medianDiff = (diffs[mid - 1] + diffs[mid]) / 2m;
        //    else
        //        medianDiff = diffs[mid];

        //    if (medianDiff <= 0)
        //        medianDiff = diffs[0];

        //    var threshold = medianDiff;

        //    // Строим кластеры по allPrices
        //    var clusters = new List<(int start, int end)>();
        //    int startIdx = 0;
        //    for (int i = 1; i < allPrices.Count; i++)
        //    {
        //        var gap = allPrices[i] - allPrices[i - 1];
        //        if (gap <= threshold)
        //            continue;

        //        clusters.Add((startIdx, i - 1));
        //        startIdx = i;
        //    }
        //    clusters.Add((startIdx, allPrices.Count - 1));

        //    var resultLevels = new List<decimal>();

        //    foreach (var (start, end) in clusters)
        //    {
        //        var lowBound = allPrices[start];
        //        var highBound = allPrices[end];

        //        int highTouches = highs.Count(h => h >= lowBound && h <= highBound);
        //        int lowTouches = lows.Count(l => l >= lowBound && l <= highBound);
        //        int totalTouches = highTouches + lowTouches;

        //        // Нас интересуют только уровни, где есть и high, и low,
        //        // и при этом достаточно суммарных касаний
        //        if (highTouches < minHighTouches ||
        //            lowTouches < minLowTouches ||
        //            totalTouches < minTotalTouches)
        //        {
        //            continue;
        //        }

        //        var clusterValues = allPrices
        //            .Where(v => v >= lowBound && v <= highBound)
        //            .ToList();

        //        if (clusterValues.Count == 0)
        //            continue;

        //        var level = clusterValues.Average();
        //        resultLevels.Add(level);
        //    }

        //    // на всякий случай отсортируем уровни по возрастанию и уберём дубликаты
        //    return resultLevels
        //        .OrderBy(x => x)
        //        .Distinct()
        //        .ToList();
        //}
    }
}
