using System;
using System.Collections.Generic;
using System.Linq;
using DealManager.Models;

namespace DealManager.Services
{
    public class TrendAnalyzer
    {
        // Локальный пивот (локальный максимум/минимум)
        private sealed record Pivot(int Index, decimal Price, bool IsHigh, DateTime Date);

        // Кластер из пивотов = горизонтальная зона
        private sealed class SrCluster
        {
            public decimal SumPrice;
            public int Count;

            public decimal MinPrice = decimal.MaxValue;
            public decimal MaxPrice = decimal.MinValue;

            public int HighTouches;
            public int LowTouches;

            // индекс последнего бара, где был пивот (для "свежести")
            public int LastIndex;

            public DateTime FirstTouch = DateTime.MaxValue;
            public DateTime LastTouch = DateTime.MinValue;

            public decimal Level => Count == 0 ? 0m : SumPrice / Count;

            public void Add(Pivot p)
            {
                SumPrice += p.Price;
                Count++;

                if (p.Price < MinPrice) MinPrice = p.Price;
                if (p.Price > MaxPrice) MaxPrice = p.Price;

                if (p.IsHigh) HighTouches++;
                else LowTouches++;

                if (p.Index > LastIndex) LastIndex = p.Index;

                if (p.Date < FirstTouch) FirstTouch = p.Date;
                if (p.Date > LastTouch) LastTouch = p.Date;
            }
        }

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

        // ---------- УРОВНИ ПОДДЕРЖКИ / СОПРОТИВЛЕНИЯ ----------

        public IReadOnlyList<SupportResistanceLevel> DetectSupportResistanceLevels(
            IReadOnlyList<PricePoint> points,
            int minHighTouches = 1,
            int minLowTouches = 1,
            int minTotalTouches = 3,
            int maxLevels = 10,
            int pivotWindow = 2,
            decimal maxRangePercent = 0.12m) // ~12% ширина зоны
        {
            if (points == null || points.Count < pivotWindow * 2 + 1)
                return Array.Empty<SupportResistanceLevel>();

            // строго по времени
            var ordered = points
                .OrderBy(p => p.Date)
                .ToList();

            var pivots = GetPivots(ordered, pivotWindow);
            if (pivots.Count == 0)
                return Array.Empty<SupportResistanceLevel>();

            var clusters = BuildClusters(pivots, maxRangePercent);

            var lastClose = ordered[^1].Close;
            var totalBars = ordered.Count;

            var levels = new List<SupportResistanceLevel>();

            foreach (var c in clusters)
            {
                int totalTouches = c.HighTouches + c.LowTouches;

                // фильтры по касаниям
                if (c.HighTouches < minHighTouches ||
                    c.LowTouches < minLowTouches ||
                    totalTouches < minTotalTouches)
                {
                    continue;
                }

                var levelPrice = c.Level;
                var lowBound = c.MinPrice;
                var highBound = c.MaxPrice;

                var score = ComputeSrScore(
                    levelPrice,
                    c.HighTouches,
                    c.LowTouches,
                    lastClose,
                    totalBars,
                    c.LastIndex);

                levels.Add(new SupportResistanceLevel
                {
                    Level = levelPrice,
                    LowBound = lowBound,
                    HighBound = highBound,
                    HighTouches = c.HighTouches,
                    LowTouches = c.LowTouches,
                    FirstTouch = c.FirstTouch,
                    LastTouch = c.LastTouch,
                    Score = score
                });
            }

            // сортируем по "силе" с учётом расстояния от цены и свежести
            var orderedByScore = levels
                .OrderByDescending(l => l.Score)
                .ToList();

            if (maxLevels > 0 && orderedByScore.Count > maxLevels)
                orderedByScore = orderedByScore.Take(maxLevels).ToList();

            return orderedByScore;
        }

        public IReadOnlyList<SupportResistanceLevel> DetectSupportResistanceLevels(
            PriceSeriesDto series,
            int minHighTouches = 1,
            int minLowTouches = 1,
            int minTotalTouches = 3,
            int maxLevels = 10,
            int pivotWindow = 2,
            decimal maxRangePercent = 0.12m)
        {
            if (series == null)
                return Array.Empty<SupportResistanceLevel>();

            return DetectSupportResistanceLevels(
                series.Points,
                minHighTouches,
                minLowTouches,
                minTotalTouches,
                maxLevels,
                pivotWindow,
                maxRangePercent);
        }

        // ---------- СЛУЖЕБНЫЕ МЕТОДЫ ДЛЯ УРОВНЕЙ ----------

        private static List<Pivot> GetPivots(IReadOnlyList<PricePoint> points, int window)
        {
            var pivots = new List<Pivot>();

            // points должны быть отсортированы по дате
            for (int i = window; i < points.Count - window; i++)
            {
                var cur = points[i];
                var curHigh = cur.High;
                var curLow = cur.Low;

                bool isHigh = true;
                bool isLow = true;

                for (int j = i - window; j <= i + window; j++)
                {
                    if (points[j].High > curHigh) isHigh = false;
                    if (points[j].Low < curLow) isLow = false;

                    if (!isHigh && !isLow)
                        break;
                }

                if (isHigh)
                    pivots.Add(new Pivot(i, curHigh, true, cur.Date));  // <- тут

                if (isLow)
                    pivots.Add(new Pivot(i, curLow, false, cur.Date));  // <- и тут
            }

            return pivots;
        }

        // Кластеры – зоны, где (max-min)/mid <= maxRangePercent
        private static List<SrCluster> BuildClusters(
            List<Pivot> pivots,
            decimal maxRangePercent)
        {
            var ordered = pivots.OrderBy(p => p.Price).ToList();
            var clusters = new List<SrCluster>();

            foreach (var p in ordered)
            {
                SrCluster? bestCluster = null;
                decimal bestWidth = decimal.MaxValue;

                foreach (var c in clusters)
                {
                    var minPrice = Math.Min(c.MinPrice, p.Price);
                    var maxPrice = Math.Max(c.MaxPrice, p.Price);
                    var mid = (minPrice + maxPrice) / 2m;
                    if (mid <= 0) continue;

                    var widthPercent = (maxPrice - minPrice) / mid;

                    if (widthPercent <= maxRangePercent && widthPercent < bestWidth)
                    {
                        bestWidth = widthPercent;
                        bestCluster = c;
                    }
                }

                if (bestCluster == null)
                {
                    var c = new SrCluster();
                    c.Add(p);
                    clusters.Add(c);
                }
                else
                {
                    bestCluster.Add(p);
                }
            }

            return clusters;
        }

        // Сила уровня: касания * бонус за обе стороны * близость к цене * свежесть
        private static double ComputeSrScore(
            decimal levelPrice,
            int highTouches,
            int lowTouches,
            decimal lastClose,
            int totalBars,
            int lastIndex)
        {
            var touches = highTouches + lowTouches;
            if (touches == 0) return 0;

            // бонус, если уровень отрабатывался и как хай, и как лоу
            var bothSidesBonus = 1.0 + 0.3 * Math.Min(highTouches, lowTouches);

            double distanceWeight = 1.0;
            if (lastClose > 0)
            {
                var distance = (double)Math.Abs(levelPrice - lastClose) / (double)lastClose;
                // чем дальше от текущей цены, тем меньше вес
                distanceWeight = 1.0 / (1.0 + distance * 5.0);
            }

            // "возраст" уровня в барах
            var age = Math.Max(1, totalBars - lastIndex);
            // чем свежее, тем больше вес
            var timeWeight = 1.0 / (1.0 + age / 52.0); // 52 бара условно ~год

            return touches * bothSidesBonus * distanceWeight * timeWeight;
        }
    }
}
