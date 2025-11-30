using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace DealManager.Models
{
    public class Deal
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public string Id { get; set; } = null!;

        public bool Closed { get; set; }
        public DateTime? ClosedAt { get; set; }

        public string Date { get; set; } = "";         // yyyy-MM-dd, как в форме
        public string Stock { get; set; } = "";
        public string Notes { get; set; } = "";

        public string Take_Profit { get; set; } = "";
        public string Stop_Loss { get; set; } = "";

        // и дальше остальные поля формы
        // public string InCollection { get; set; }
        // public string Volatility { get; set; }
        // ...
    }
}
