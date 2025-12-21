using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System.Text.Json.Serialization;

namespace DealManager.Models;

[BsonIgnoreExtraElements]
public sealed class AiChatThread
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    public string UserId { get; set; } = "";

    public string Ticker { get; set; } = "";

    public string? StockId { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

    public List<AiChatMessage> Messages { get; set; } = new();
}

public sealed class AiChatMessage
{
    public string Role { get; set; } = "user"; // user | assistant | system

    public string Content { get; set; } = "";

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}


