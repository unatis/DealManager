using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

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

        public bool BetaVolatility { get; set; }
    }
}
