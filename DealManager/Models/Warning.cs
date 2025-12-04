using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System.Text.Json.Serialization;

namespace DealManager.Models
{
    public class Warning
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public string? Id { get; set; }

        [BsonElement("ownerId")]
        [JsonPropertyName("ownerId")]
        public string OwnerId { get; set; } = "";

        [BsonElement("ticker")]
        [JsonPropertyName("ticker")]
        public string Ticker { get; set; } = "";

        [BsonElement("stockId")]
        [JsonPropertyName("stockId")]
        public string? StockId { get; set; }

        [BsonElement("regular_share_volume")]
        [JsonPropertyName("regular_share_volume")]
        public bool RegularShareVolume { get; set; } = false;

        [BsonElement("sp500_member")]
        [JsonPropertyName("sp500_member")]
        public bool Sp500Member { get; set; } = false;

        [BsonElement("atr_high_risk")]
        [JsonPropertyName("atr_high_risk")]
        public bool AtrHighRisk { get; set; } = false;

        [BsonElement("sync_sp500_no")]
        [JsonPropertyName("sync_sp500_no")]
        public bool SyncSp500No { get; set; } = false;

        [BsonElement("beta_volatility_high")]
        [JsonPropertyName("beta_volatility_high")]
        public bool BetaVolatilityHigh { get; set; } = false;

        [BsonElement("createdAt")]
        [JsonPropertyName("createdAt")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [BsonElement("updatedAt")]
        [JsonPropertyName("updatedAt")]
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}

