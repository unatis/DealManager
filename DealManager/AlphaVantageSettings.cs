namespace DealManager
{
    public class AlphaVantageSettings
    {
        public string ApiKey { get; set; } = string.Empty;
        public string BaseUrl { get; set; } = "https://www.alphavantage.co";
        public int CacheMinutes { get; set; } = 15;
    }
}
