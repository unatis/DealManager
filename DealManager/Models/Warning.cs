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

        [BsonElement("regular_share_volume")]
        [JsonPropertyName("regular_share_volume")]
        public bool RegularShareVolume { get; set; } = false;

        [BsonElement("createdAt")]
        [JsonPropertyName("createdAt")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [BsonElement("updatedAt")]
        [JsonPropertyName("updatedAt")]
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}

