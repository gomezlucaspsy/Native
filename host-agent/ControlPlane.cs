using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

// HTTP client for the Next.js control-plane API.
internal sealed class ControlPlane(HttpClient http, AgentConfig cfg)
{
    public async Task RegisterAsync()
    {
        var res = await http.PostAsJsonAsync(cfg.RegisterEndpoint,
            new RegisterRequest(cfg.AgentId, cfg.AgentLabel, cfg.AgentPlatform, cfg.AgentVersion));
        res.EnsureSuccessStatusCode();
        Console.WriteLine($"agent registered  id={cfg.AgentId}");
    }

    public async Task HeartbeatAsync()
    {
        var res = await http.PostAsJsonAsync(cfg.HeartbeatEndpoint,
            new HeartbeatRequest(cfg.AgentId));

        if (res.StatusCode == HttpStatusCode.NotFound)
        {
            // Server restarted — re-register then continue
            await RegisterAsync();
            return;
        }

        res.EnsureSuccessStatusCode();
    }

    public async Task<IReadOnlyList<Command>> PollCommandsAsync()
    {
        var url = $"{cfg.CommandsEndpoint}?agentId={Uri.EscapeDataString(cfg.AgentId)}";
        var res = await http.GetAsync(url);
        res.EnsureSuccessStatusCode();

        var payload = await res.Content.ReadFromJsonAsync<CommandsResponse>();
        return payload?.Commands ?? [];
    }

    public async Task ReportAsync(string commandId, bool ok, string output)
    {
        var res = await http.PostAsJsonAsync(cfg.CommandResultEndpoint,
            new CommandResultRequest(cfg.AgentId, commandId, ok, output));
        res.EnsureSuccessStatusCode();
    }

    // ── wire types ───────────────────────────────────────────────────────────

    record RegisterRequest(
        [property: JsonPropertyName("agentId")]  string AgentId,
        [property: JsonPropertyName("label")]    string Label,
        [property: JsonPropertyName("platform")] string Platform,
        [property: JsonPropertyName("version")]  string Version);

    record HeartbeatRequest(
        [property: JsonPropertyName("agentId")] string AgentId);

    record CommandResultRequest(
        [property: JsonPropertyName("agentId")]    string AgentId,
        [property: JsonPropertyName("commandId")]  string CommandId,
        [property: JsonPropertyName("success")]    bool   Success,
        [property: JsonPropertyName("result")]     string Result);
}

// Shared response types used by both ControlPlane and Program
internal sealed record Command(
    [property: JsonPropertyName("id")]      string Id,
    [property: JsonPropertyName("agentId")] string AgentId,
    [property: JsonPropertyName("type")]    string Type,
    [property: JsonPropertyName("payload")] Dictionary<string, JsonElement>? Payload);

internal sealed record CommandsResponse(
    [property: JsonPropertyName("commands")] List<Command> Commands);
