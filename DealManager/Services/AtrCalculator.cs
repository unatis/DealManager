using System;
using System.Collections.Generic;
using System.Linq;
using DealManager.Models;

namespace DealManager.Services
{
    public static class AtrCalculator
    {
        /// <summary>
        /// Calculates Average True Range (ATR) for a given period.
        /// ATR measures market volatility based on True Range (TR).
        /// TR = Max(High - Low, |High - Previous Close|, |Low - Previous Close|)
        /// ATR = Simple Moving Average of TR over N periods (typically 14)
        /// </summary>
        /// <param name="candles">List of price candles (must be ordered by date ascending)</param>
        /// <param name="period">ATR period (default 14, typical values: 14, 20)</param>
        /// <returns>ATR result with current ATR value and calculation details</returns>
        public static AtrResult CalculateAtr(
            IReadOnlyList<PricePoint> candles,
            int period = 14)
        {
            if (candles == null) 
                throw new ArgumentNullException(nameof(candles));
            
            if (period <= 0) 
                throw new ArgumentOutOfRangeException(nameof(period), "Period must be greater than 0");
            
            if (candles.Count < period + 1) 
                throw new ArgumentException(
                    $"Insufficient candles. Need at least {period + 1} candles for ATR period {period}, but got {candles.Count}",
                    nameof(candles));

            // Ensure candles are ordered by date (ascending)
            var orderedCandles = candles
                .OrderBy(c => c.Date)
                .ToList();

            // Calculate True Range (TR) for each candle (starting from index 1)
            var trueRanges = new List<decimal>();
            
            for (int i = 1; i < orderedCandles.Count; i++)
            {
                var current = orderedCandles[i];
                var previous = orderedCandles[i - 1];
                
                // True Range = Max of:
                // 1. High - Low
                // 2. |High - Previous Close|
                // 3. |Low - Previous Close|
                decimal tr1 = current.High - current.Low;
                decimal tr2 = Math.Abs(current.High - previous.Close);
                decimal tr3 = Math.Abs(current.Low - previous.Close);
                
                decimal trueRange = Math.Max(tr1, Math.Max(tr2, tr3));
                trueRanges.Add(trueRange);
            }

            if (trueRanges.Count < period)
            {
                throw new InvalidOperationException(
                    $"Insufficient True Range values. Need at least {period} TR values for ATR period {period}, but got {trueRanges.Count}");
            }

            // Calculate ATR as Simple Moving Average of the last 'period' True Range values
            var recentTrueRanges = trueRanges
                .TakeLast(period)
                .ToList();

            decimal atrValue = recentTrueRanges.Average();

            // Calculate ATR as percentage of current close price
            var latestClose = orderedCandles.Last().Close;
            decimal? atrPercent = latestClose > 0 
                ? (atrValue / latestClose) * 100m 
                : null;

            return new AtrResult(
                AtrValue: atrValue,
                AtrPercent: atrPercent,
                Period: period,
                CandlesUsed: orderedCandles.Count,
                TrueRangesCount: trueRanges.Count,
                LatestClose: latestClose,
                TrueRanges: recentTrueRanges // Last N True Range values
            );
        }
    }

    /// <summary>
    /// Result of ATR calculation
    /// </summary>
    public record AtrResult(
        decimal AtrValue,              // ATR value in price units
        decimal? AtrPercent,           // ATR as percentage of current close price
        int Period,                    // ATR period used
        int CandlesUsed,               // Total number of candles used
        int TrueRangesCount,           // Number of True Range values calculated
        decimal LatestClose,           // Latest close price
        IReadOnlyList<decimal> TrueRanges // Last N True Range values used for ATR
    );
}

















