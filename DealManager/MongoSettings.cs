namespace DealManager
{
    public class MongoSettings
    {
        public string ConnectionString { get; set; } = "";
        public string Database { get; set; } = "";
        public string DealsCollection { get; set; } = "deals";
        public string StocksCollection { get; set; } = "stocks";
        public string QuotesCollection { get; set; } = "quotes";
        public string WeeklyPricesCollection { get; set; } = "weekly_prices";
        public string WarningsCollection { get; set; } = "warnings";
        public string PinnedStocksCollection { get; set; } = "pinned_stocks";
        public string AiChatsCollection { get; set; } = "ai_chats";
    }
}

