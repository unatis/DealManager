using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System.Text.Json.Serialization;

namespace DealManager.Models
{
    public class Stock
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public string Id { get; set; } = null!;

        // владелец – тот же user.Id, который кладём в JWT как sub
        public string OwnerId { get; set; } = null!;

        public string Ticker { get; set; } = "";
        public string? Desc { get; set; }

        public bool Sp500Member { get; set; }
        public bool AverageWeekVol { get; set; }

        [JsonPropertyName("betaVolatility")]
        public string? BetaVolatility { get; set; }

        [JsonPropertyName("regular_volume")]
        public string? RegularVolume { get; set; }

        [JsonPropertyName("sync_sp500")]
        public string? SyncSp500 { get; set; }

        [JsonPropertyName("atr")]
        public string? Atr { get; set; }
    }
}
