using MongoDB.Bson.Serialization.Attributes;

namespace DealManager.Models;

[BsonIgnoreExtraElements]
public class PricePoint
{
    [BsonElement("date")]
    public DateTime Date { get; set; }

    [BsonElement("open")]
    public decimal Open { get; set; }

    [BsonElement("high")]
    public decimal High { get; set; }

    [BsonElement("low")]
    public decimal Low { get; set; }

    [BsonElement("close")]
    public decimal Close { get; set; }

    [BsonElement("volume")]
    public long Volume { get; set; }
}
