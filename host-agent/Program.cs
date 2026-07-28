using System.Net.Http.Headers;

// ── Single-instance guard ─────────────────────────────────────────────────────
// Guards against a stale instance (e.g. left over from a crash) still running
// when a new one starts — without this, two instances race on the same command
// queue and only one of them wins each poll.
using var singleInstance = new Mutex(true, "NativeHostAgentMutex", out var isFirstInstance);
if (!isFirstInstance)
{
    Console.WriteLine("host-agent is already running — exiting.");
    Environment.Exit(0);
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
var cfg = AgentConfig.FromEnvironment(args);

using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("NativeHostAgent", cfg.AgentVersion));
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", cfg.AuthToken);

var plane = new ControlPlane(http, cfg);

await plane.RegisterAsync();
Console.WriteLine($"polling {cfg.CommandsEndpoint} every {cfg.PollInterval.TotalSeconds:0}s");

// ── Main loop ────────────────────────────────────────────────────────────────
while (true)
{
    try
    {
        await plane.HeartbeatAsync();

        var commands = await plane.PollCommandsAsync();
        foreach (var cmd in commands)
        {
            var (ok, output) = cmd.Type switch
            {
                "sync_media"  => (true, "media sync job enqueued"),
                "list_files"  => FileAccess.List(cmd.Payload, cfg.SharedRoot),
                "read_file"   => FileAccess.Read(cmd.Payload, cfg.SharedRoot),
                var unknown   => (false, $"unsupported command: {unknown}"),
            };

            Console.WriteLine($"cmd={cmd.Type} ok={ok}");
            await plane.ReportAsync(cmd.Id, ok, output);
        }
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"tick error: {ex.Message}");
    }

    if (cfg.Once) break;
    await Task.Delay(cfg.PollInterval);
}
