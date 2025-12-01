namespace DealManager
{
    public class MongoSettings
    {
        public string ConnectionString { get; set; } = "";
        public string Database { get; set; } = "";
        public string DealsCollection { get; set; } = "deals";

        public string StocksCollection { get; set; } = "stocks";
    }
}
