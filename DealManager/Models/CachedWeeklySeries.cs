using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace DealManager.Models;

[BsonIgnoreExtraElements]
public class CachedWeeklySeries
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("ticker")]
    public string Ticker { get; set; } = string.Empty;

    [BsonElement("points")]
    public List<PricePoint> Points { get; set; } = new();

    [BsonElement("lastUpdatedUtc")]
    public DateTime LastUpdatedUtc { get; set; }
}











