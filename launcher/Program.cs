using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;

namespace NativeLauncher;

static class Program
{
    static NotifyIcon? _tray;
    static Process?    _web;
    static Process?    _agent;
    static readonly string Root  = FindRoot();
    static readonly string Port  = "3000";
    static readonly string Url   = $"http://localhost:{Port}";

    [STAThread]
    static void Main()
    {
        // Only one instance
        var mutex = new Mutex(true, "NativeShareLauncher", out bool first);
        if (!first) { OpenBrowser(); return; }

        ApplicationConfiguration.Initialize();

        BuildTray();
        StartWeb();
        StartAgent();

        // Open browser once web is ready
        Task.Run(WaitAndOpenBrowser);

        Application.Run();

        mutex.ReleaseMutex();
    }

    // ── Tray ────────────────────────────────────────────────────────────────
    static void BuildTray()
    {
        var icon = LoadIcon();

        _tray = new NotifyIcon
        {
            Icon    = icon,
            Text    = "Native Share",
            Visible = true,
        };

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Dashboard",  null, (_, _) => OpenBrowser());
        menu.Items.Add("Open Hotspot",    null, (_, _) => OpenBrowser("/"));
        menu.Items.Add("-");
        menu.Items.Add("Restart Services", null, (_, _) => { StopAll(); StartWeb(); StartAgent(); });
        menu.Items.Add("-");
        menu.Items.Add("Exit", null, (_, _) => Exit());

        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => OpenBrowser();

        _tray.ShowBalloonTip(3000, "Native Share", "Starting… click the tray icon to open.", ToolTipIcon.Info);
    }

    static Icon LoadIcon()
    {
        // Try embedded resource first, fallback to file
        var asm = Assembly.GetExecutingAssembly();
        var name = asm.GetManifestResourceNames()
                      .FirstOrDefault(n => n.EndsWith("icon.ico", StringComparison.OrdinalIgnoreCase));
        if (name != null)
        {
            using var stream = asm.GetManifestResourceStream(name)!;
            return new Icon(stream);
        }

        var file = Path.Combine(Root, "launcher", "icon.ico");
        if (File.Exists(file)) return new Icon(file);

        return SystemIcons.Application;
    }

    // ── Web (Next.js) ───────────────────────────────────────────────────────
    static void StartWeb()
    {
        KillPort(3000);

        var logPath = Path.Combine(Root, "dist", "web.log");
        File.WriteAllText(logPath, $"[{DateTime.Now}] Starting Next.js in {Root}\n");

        // Use cmd /c to ensure PATH is fully resolved in the shell
        var psi = new ProcessStartInfo("cmd.exe")
        {
            Arguments        = $"/c \"cd /d \"{Root}\" && npx next dev --hostname 0.0.0.0 --port {Port} >> \"{logPath}\" 2>&1\"",
            UseShellExecute  = false,
            CreateNoWindow   = true,
            WorkingDirectory = Root,
        };

        // Inject env vars via cmd SET
        psi.Environment["HOST_AGENT_TOKEN"] = "native-dev-token";
        LoadDotEnv(Path.Combine(Root, ".env.local"), psi);

        _web = Process.Start(psi);
    }

    static void LoadDotEnv(string path, ProcessStartInfo psi)
    {
        if (!File.Exists(path)) return;
        foreach (var line in File.ReadAllLines(path))
        {
            if (string.IsNullOrWhiteSpace(line) || line.StartsWith('#')) continue;
            var idx = line.IndexOf('=');
            if (idx < 1) continue;
            var key = line[..idx].Trim();
            var val = line[(idx + 1)..].Trim().Trim('"');
            if (!string.IsNullOrEmpty(key) && !psi.Environment.ContainsKey(key))
                psi.Environment[key] = val;
        }
    }

    // ── Agent (C#) ──────────────────────────────────────────────────────────
    static void StartAgent()
    {
        // Try pre-built Release exe first, fall back to dotnet run
        var exe = Path.Combine(Root, "host-agent", "bin", "Release", "net8.0", "host-agent.exe");

        ProcessStartInfo psi;

        if (File.Exists(exe))
        {
            psi = new ProcessStartInfo
            {
                FileName         = exe,
                UseShellExecute  = true,   // keeps it elevated via manifest
                CreateNoWindow   = false,
                WorkingDirectory = Path.Combine(Root, "host-agent"),
            };
        }
        else
        {
            psi = new ProcessStartInfo
            {
                FileName               = "dotnet",
                Arguments              = "run --project host-agent/host-agent.csproj -c Release",
                WorkingDirectory       = Root,
                UseShellExecute        = false,
                CreateNoWindow         = true,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
            };
        }

        psi.Environment["CONTROL_PLANE_URL"]            = Url;
        psi.Environment["HOST_AGENT_TOKEN"]             = "native-dev-token";
        psi.Environment["HOST_AGENT_ID"]                = "host-main";
        psi.Environment["HOST_AGENT_LABEL"]             = "Main Host";
        psi.Environment["HOST_AGENT_POLL_INTERVAL_SECS"] = "5";

        _agent = Process.Start(psi);
    }

    // ── Browser ─────────────────────────────────────────────────────────────
    static async Task WaitAndOpenBrowser()
    {
        using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        for (int i = 0; i < 45; i++)
        {
            await Task.Delay(2000);
            try
            {
                var r = await http.GetAsync($"{Url}/api/status");
                if (r.IsSuccessStatusCode) { OpenBrowser(); return; }
            }
            catch { }
        }
        // Timed out — open anyway
        OpenBrowser();
    }

    static void OpenBrowser(string path = "/")
    {
        Process.Start(new ProcessStartInfo($"{Url}{path}") { UseShellExecute = true });
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────
    static void StopAll()
    {
        TryKill(_web);
        TryKill(_agent);
        KillPort(3000);
    }

    static void Exit()
    {
        _tray!.Visible = false;
        StopAll();
        Application.Exit();
    }

    static void TryKill(Process? p)
    {
        try { if (p != null && !p.HasExited) { p.Kill(true); p.WaitForExit(3000); } }
        catch { }
    }

    static void KillPort(int port)
    {
        try
        {
            var psi = new ProcessStartInfo("cmd", $"/c for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :{port}') do taskkill /F /PID %a")
            { UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi);
            p?.WaitForExit(3000);
        }
        catch { }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    static void CopyEnvVar(ProcessStartInfo psi, string key)
    {
        var val = Environment.GetEnvironmentVariable(key);
        if (!string.IsNullOrEmpty(val)) psi.Environment[key] = val;
    }

    static string FindRoot()
    {
        // For single-file exe, AppContext.BaseDirectory is a temp extraction dir.
        // Use the exe's actual location instead.
        var exeDir = Path.GetDirectoryName(Environment.ProcessPath ?? AppContext.BaseDirectory)
                     ?? AppContext.BaseDirectory;

        // Walk up looking for package.json (Next.js root marker)
        var dir = exeDir;
        while (dir != null)
        {
            if (File.Exists(Path.Combine(dir, "package.json"))) return dir;
            dir = Path.GetDirectoryName(dir);
        }

        // Fallback: exe is in dist/ inside the project root
        return Path.GetFullPath(Path.Combine(exeDir, ".."));
    }
}
