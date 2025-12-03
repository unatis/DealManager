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
                var prevLow = points[i - 1].Low;
                var currLow = points[i].Low;
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
    }
}
