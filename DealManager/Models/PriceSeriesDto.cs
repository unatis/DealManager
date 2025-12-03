namespace DealManager.Models
{
    public class PriceSeriesDto
    {
        public string Symbol { get; set; } = string.Empty;
        /// <summary>UTC время последнего обновления с Alpha Vantage (как они отдают).</summary>
        public DateTime? LastRefreshed { get; set; }
        public List<PricePoint> Points { get; set; } = new();
    }
}
