namespace DealManager.Models
{
    public class PricePoint
    {
        public DateTime Date { get; set; }
        public decimal Open { get; set; }
        public decimal High { get; set; }
        public decimal Low { get; set; }
        public decimal Close { get; set; }
        public long Volume { get; set; }
    }

    public class PriceSeriesDto
    {
        public string Symbol { get; set; } = string.Empty;
        /// <summary>UTC время последнего обновления с Alpha Vantage (как они отдают).</summary>
        public DateTime? LastRefreshed { get; set; }
        public List<PricePoint> Points { get; set; } = new();
    }
}
