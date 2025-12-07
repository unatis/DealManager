using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System.Text.Json.Serialization;

namespace DealManager.Models
{
    public class PinnedStock
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public string Id { get; set; } = null!;

        /// <summary>
        /// Владелец pinned-акции (userId из JWT, тот же, что и для сделок/акций).
        /// </summary>
        public string OwnerId { get; set; } = null!;

        [JsonPropertyName("ticker")]
        public string Ticker { get; set; } = string.Empty;

        /// <summary>
        /// Порядок отображения в панели Tools.
        /// </summary>
        [JsonPropertyName("order")]
        public int Order { get; set; }
    }
}



