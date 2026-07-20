using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;

var config = AgentConfig.FromEnvironment(args);
using var httpClient = new HttpClient
{
    Timeout = TimeSpan.FromSeconds(10)
};
httpClient.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("NativeHostAgent", "0.1"));
httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.AuthToken);

await RegisterAgentAsync(httpClient, config);

Console.WriteLine(
    $"Native Host Agent started. id={config.AgentId} polling={config.CommandsEndpoint} interval={config.PollInterval.TotalSeconds:0}s");

while (true)
{
    try
    {
        var handled = await TickAsync(httpClient, config);
        Console.WriteLine($"host-agent: tick complete, commands handled={handled}");
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"host-agent: tick failed: {ex}");
    }

    if (config.Once)
    {
        break;
    }

    await Task.Delay(config.PollInterval);
}

return;

static async Task<int> TickAsync(HttpClient client, AgentConfig config)
{
    try
    {
        await SendHeartbeatAsync(client, config);
    }
    catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
    {
        await RegisterAgentAsync(client, config);
    }
    catch (HttpRequestException ex)
    {
        throw new InvalidOperationException("heartbeat failed with HTTP status", ex);
    }

    var commands = await FetchCommandsAsync(client, config);
    foreach (var command in commands)
    {
        var (success, result) = ExecuteCommand(command);
        await ReportCommandResultAsync(client, config, command.Id, success, result);
    }

    return commands.Count;
}

static async Task RegisterAgentAsync(HttpClient client, AgentConfig config)
{
    var response = await client.PostAsJsonAsync(
        config.RegisterEndpoint,
        new RegisterRequest(config.AgentId, config.AgentLabel, config.AgentPlatform, config.AgentVersion));

    response.EnsureSuccessStatusCode();
    _ = await response.Content.ReadAsByteArrayAsync();
    Console.WriteLine($"host-agent: registered agent {config.AgentId}");
}

static async Task SendHeartbeatAsync(HttpClient client, AgentConfig config)
{
    var response = await client.PostAsJsonAsync(
        config.HeartbeatEndpoint,
        new HeartbeatRequest(config.AgentId));

    response.EnsureSuccessStatusCode();
}

static async Task<List<Command>> FetchCommandsAsync(HttpClient client, AgentConfig config)
{
    var endpoint = $"{config.CommandsEndpoint}?agentId={Uri.EscapeDataString(config.AgentId)}";
    var response = await client.GetAsync(endpoint);
    response.EnsureSuccessStatusCode();

    var payload = await response.Content.ReadFromJsonAsync<CommandsResponse>();
    return payload?.Commands ?? [];
}

static async Task ReportCommandResultAsync(
    HttpClient client,
    AgentConfig config,
    string commandId,
    bool success,
    string result)
{
    var response = await client.PostAsJsonAsync(
        config.CommandResultEndpoint,
        new CommandResultRequest(config.AgentId, commandId, success, result));

    response.EnsureSuccessStatusCode();
}

static (bool Success, string Result) ExecuteCommand(Command command)
{
    return command.CommandType switch
    {
        "scan_devices"  => RunNetsh("wlan show hostednetwork"),
        "start_hotspot" => RunNetsh("wlan start hostednetwork"),
        "stop_hotspot"  => RunNetsh("wlan stop hostednetwork"),
        "sync_media"    => (true, "media sync job enqueued"),
        var unknown     => (false, $"unsupported command: {unknown}")
    };
}

static (bool Success, string Result) RunNetsh(string args)
{
    try
    {
        var psi = new System.Diagnostics.ProcessStartInfo("netsh", args)
        {
            RedirectStandardOutput = true,
            RedirectStandardError  = true,
            UseShellExecute        = false,
            CreateNoWindow         = true
        };
        using var proc = System.Diagnostics.Process.Start(psi)!;
        proc.WaitForExit(8000);
        var stdout = proc.StandardOutput.ReadToEnd().Trim();
        var stderr = proc.StandardError.ReadToEnd().Trim();
        var ok     = proc.ExitCode == 0;
        return (ok, ok ? stdout : (stderr.Length > 0 ? stderr : stdout));
    }
    catch (Exception ex)
    {
        return (false, ex.Message);
    }
}

internal sealed class AgentConfig
{
    public required string ControlPlaneUrl { get; init; }
    public required string AgentId { get; init; }
    public required string AgentLabel { get; init; }
    public required string AgentPlatform { get; init; }
    public required string AgentVersion { get; init; }
    public required string AuthToken { get; init; }
    public required TimeSpan PollInterval { get; init; }
    public required bool Once { get; init; }

    public string RegisterEndpoint => $"{ControlPlaneUrl}/api/agent/register";
    public string HeartbeatEndpoint => $"{ControlPlaneUrl}/api/agent/heartbeat";
    public string CommandsEndpoint => $"{ControlPlaneUrl}/api/agent/commands";
    public string CommandResultEndpoint => $"{ControlPlaneUrl}/api/agent/command-result";

    public static AgentConfig FromEnvironment(string[] args)
    {
        var controlPlaneUrl = (Environment.GetEnvironmentVariable("CONTROL_PLANE_URL") ?? "http://localhost:3000").TrimEnd('/');

        var pollIntervalRaw = Environment.GetEnvironmentVariable("HOST_AGENT_POLL_INTERVAL_SECS");
        ulong pollIntervalSecs = 15;
        if (!string.IsNullOrWhiteSpace(pollIntervalRaw) && !ulong.TryParse(pollIntervalRaw, out pollIntervalSecs))
        {
            throw new InvalidOperationException("HOST_AGENT_POLL_INTERVAL_SECS must be a positive integer");
        }

        return new AgentConfig
        {
            ControlPlaneUrl = controlPlaneUrl,
            AgentId = Environment.GetEnvironmentVariable("HOST_AGENT_ID") ?? "host-main",
            AgentLabel = Environment.GetEnvironmentVariable("HOST_AGENT_LABEL") ?? "Main Host",
            AgentPlatform = Environment.GetEnvironmentVariable("HOST_AGENT_PLATFORM") ?? GetDefaultPlatform(),
            AgentVersion = Environment.GetEnvironmentVariable("HOST_AGENT_VERSION") ?? "0.1.0",
            AuthToken = Environment.GetEnvironmentVariable("HOST_AGENT_TOKEN") ?? "native-dev-token",
            PollInterval = TimeSpan.FromSeconds(pollIntervalSecs),
            Once = args.Contains("--once")
        };
    }

    private static string GetDefaultPlatform()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return "windows";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX)) return "macos";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux)) return "linux";
        return RuntimeInformation.OSDescription;
    }
}

internal sealed record Command(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("agentId")] string AgentId,
    [property: JsonPropertyName("type")] string CommandType,
    [property: JsonPropertyName("payload")] JsonElement Payload);

internal sealed record CommandsResponse(
    [property: JsonPropertyName("commands")] List<Command> Commands);

internal sealed record RegisterRequest(
    [property: JsonPropertyName("agentId")] string AgentId,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("platform")] string Platform,
    [property: JsonPropertyName("version")] string Version);

internal sealed record HeartbeatRequest(
    [property: JsonPropertyName("agentId")] string AgentId);

internal sealed record CommandResultRequest(
    [property: JsonPropertyName("agentId")] string AgentId,
    [property: JsonPropertyName("commandId")] string CommandId,
    [property: JsonPropertyName("success")] bool Success,
    [property: JsonPropertyName("result")] string Result);
