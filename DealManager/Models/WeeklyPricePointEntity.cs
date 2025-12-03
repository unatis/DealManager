namespace DealManager.Models
{
    public class WeeklyPricePointEntity
    {
        public int Id { get; set; }

        public string Symbol { get; set; } = string.Empty;

        public DateTime Date { get; set; }     // дата свечи (как в AlphaVantage)
        public decimal Open { get; set; }
        public decimal High { get; set; }
        public decimal Low { get; set; }
        public decimal Close { get; set; }
        public long Volume { get; set; }

        /// <summary>Когда эти данные были получены с AlphaVantage (UTC).</summary>
        public DateTime StoredAtUtc { get; set; }
    }
}
