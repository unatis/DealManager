namespace DealManager.Services;

public sealed class AiSettings
{
    public string Provider { get; set; } = "groq";
    public string Model { get; set; } = "llama-3.3-70b-versatile";
    public double Temperature { get; set; } = 0.2;

    public string? GroqApiKey { get; set; }
}


