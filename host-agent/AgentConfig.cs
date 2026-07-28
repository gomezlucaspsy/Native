using System.Runtime.InteropServices;

// Configuration loaded from environment variables / CLI args.
internal sealed class AgentConfig
{
    public required string ControlPlaneUrl { get; init; }
    public required string AgentId         { get; init; }
    public required string AgentLabel      { get; init; }
    public required string AgentPlatform   { get; init; }
    public required string AgentVersion    { get; init; }
    public required string AuthToken       { get; init; }
    public required TimeSpan PollInterval  { get; init; }
    public required bool Once              { get; init; }

    // Derived endpoints
    public string RegisterEndpoint      => $"{ControlPlaneUrl}/api/agent/register";
    public string HeartbeatEndpoint     => $"{ControlPlaneUrl}/api/agent/heartbeat";
    public string CommandsEndpoint      => $"{ControlPlaneUrl}/api/agent/commands";
    public string CommandResultEndpoint => $"{ControlPlaneUrl}/api/agent/command-result";

    public static AgentConfig FromEnvironment(string[] args)
    {
        var url = (Env("CONTROL_PLANE_URL") ?? "http://localhost:3000").TrimEnd('/');

        var pollRaw = Env("HOST_AGENT_POLL_INTERVAL_SECS");
        if (!ulong.TryParse(pollRaw ?? "15", out var pollSecs))
            throw new InvalidOperationException("HOST_AGENT_POLL_INTERVAL_SECS must be a positive integer");

        return new AgentConfig
        {
            ControlPlaneUrl = url,
            AgentId         = Env("HOST_AGENT_ID")       ?? "host-main",
            AgentLabel      = Env("HOST_AGENT_LABEL")     ?? "Main Host",
            AgentPlatform   = Env("HOST_AGENT_PLATFORM")  ?? DefaultPlatform(),
            AgentVersion    = Env("HOST_AGENT_VERSION")   ?? "0.1.0",
            AuthToken       = Env("HOST_AGENT_TOKEN")     ?? "native-dev-token",
            PollInterval    = TimeSpan.FromSeconds(pollSecs),
            Once            = args.Contains("--once"),
        };
    }

    static string? Env(string key) => Environment.GetEnvironmentVariable(key);

    static string DefaultPlatform()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return "windows";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))     return "macos";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))   return "linux";
        return RuntimeInformation.OSDescription;
    }
}
