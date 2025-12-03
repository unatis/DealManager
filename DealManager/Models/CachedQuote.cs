using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace DealManager.Models;

[BsonIgnoreExtraElements]
public class CachedQuote
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("ticker")]
    public string Ticker { get; set; } = string.Empty;

    [BsonElement("price")]
    public decimal Price { get; set; }

    // Additional GLOBAL_QUOTE fields we might use in the future
    [BsonElement("open")]
    public decimal? Open { get; set; }

    [BsonElement("high")]
    public decimal? High { get; set; }

    [BsonElement("low")]
    public decimal? Low { get; set; }

    [BsonElement("previousClose")]
    public decimal? PreviousClose { get; set; }

    [BsonElement("volume")]
    public long? Volume { get; set; }

    [BsonElement("change")]
    public decimal? Change { get; set; }

    [BsonElement("changePercent")]
    public string? ChangePercent { get; set; }

    [BsonElement("latestTradingDay")]
    public DateTime? LatestTradingDay { get; set; }

    [BsonElement("lastUpdatedUtc")]
    public DateTime LastUpdatedUtc { get; set; }
}


