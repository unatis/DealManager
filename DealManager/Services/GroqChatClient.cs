using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace DealManager.Services;

/// <summary>
/// Minimal Groq client using OpenAI-compatible Chat Completions API.
/// </summary>
public sealed class GroqChatClient
{
    private readonly HttpClient _http;
    private readonly AiSettings _settings;

    public GroqChatClient(HttpClient http, AiSettings settings)
    {
        _http = http;
        _settings = settings;
    }

    public async Task<string> ChatAsync(
        string systemPrompt,
        string userContent,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_settings.GroqApiKey))
            throw new InvalidOperationException(
                "GROQ_API_KEY is not set. Set it via environment variable GROQ_API_KEY (Render/prod) " +
                "or via .NET User Secrets key 'Ai:GroqApiKey' (local dev).");

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.groq.com/openai/v1/chat/completions");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _settings.GroqApiKey);

        req.Content = JsonContent.Create(new
        {
            model = _settings.Model,
            temperature = _settings.Temperature,
            messages = new object[]
            {
                new { role = "system", content = systemPrompt },
                new { role = "user", content = userContent }
            }
        });

        using var resp = await _http.SendAsync(req, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);

        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"Groq error {(int)resp.StatusCode}: {body}");

        using var doc = JsonDocument.Parse(body);
        return doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
    }
}


