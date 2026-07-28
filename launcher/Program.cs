using System.Diagnostics;
using System.Linq;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;

namespace NativeLauncher;

static class Program
{
    static NotifyIcon? _tray;
    static Process?    _web;
    static Process?    _agent;

    static readonly string Root       = FindRoot();
    static readonly string Port       = "3000";
    static readonly string LocalUrl   = $"http://localhost:{Port}";
    static readonly string LanIP      = GetLanIP();
    static readonly string NetworkUrl = $"http://{LanIP}:{Port}";

    [STAThread]
    static void Main()
    {
        var mutex = new Mutex(true, "NativeShareLauncher", out bool first);
        if (!first) { OpenBrowser(); return; }

        ApplicationConfiguration.Initialize();

        BuildTray();
        StartWeb();
        StartAgent();
        CreateShortcuts();

        Task.Run(WaitAndOpenBrowser);
        Application.Run();

        mutex.ReleaseMutex();
    }

    // ── Tray ─────────────────────────────────────────────────────────────────

    static void BuildTray()
    {
        _tray = new NotifyIcon
        {
            Icon    = LoadIcon(),
            Text    = "Native Share",
            Visible = true,
        };

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open App",         null, (_, _) => OpenBrowser());
        menu.Items.Add("Copy Network URL", null, (_, _) => Clipboard.SetText(NetworkUrl));
        menu.Items.Add("-");
        menu.Items.Add("Restart",          null, (_, _) => { StopAll(); StartWeb(); StartAgent(); });
        menu.Items.Add("-");
        menu.Items.Add("Exit",             null, (_, _) => Exit());

        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick     += (_, _) => OpenBrowser();
        _tray.ShowBalloonTip(3000, "Native Share", $"Starting…  {NetworkUrl}", ToolTipIcon.Info);
    }

    static Icon LoadIcon()
    {
        // 1. Embedded resource
        var asm  = Assembly.GetExecutingAssembly();
        var name = asm.GetManifestResourceNames()
                      .FirstOrDefault(n => n.EndsWith("icon.ico", StringComparison.OrdinalIgnoreCase));
        if (name != null)
            try { using var s = asm.GetManifestResourceStream(name)!; return new Icon(s); } catch { }

        // 2. File next to launcher source
        var file = Path.Combine(Root, "launcher", "icon.ico");
        if (File.Exists(file))
            try { return new Icon(file); } catch { }

        // 3. Programmatic fallback — green circle on dark background
        var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.Clear(Color.FromArgb(9, 11, 16));
            g.FillEllipse(new SolidBrush(Color.FromArgb(57, 255, 20)), 4, 4, 24, 24);
        }
        return Icon.FromHandle(bmp.GetHicon());
    }

    // ── Shortcuts — COM late binding, no external tools ───────────────────────
    //
    // Creates both a Desktop and a Start Menu shortcut, pointed at the running
    // exe with its embedded icon. Failures are logged (not swallowed) to
    // dist/install.log so a broken shortcut is diagnosable instead of just
    // silently missing.

    static void CreateShortcuts()
    {
        var exe = Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName;
        if (string.IsNullOrEmpty(exe))
        {
            LogInstall("CreateShortcuts: could not resolve the running exe path — skipped");
            return;
        }

        var desktop   = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "Native Share.lnk");
        var startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "Native Share.lnk");

        CreateShortcut(desktop, exe);
        CreateShortcut(startMenu, exe);
    }

    static void CreateShortcut(string lnkPath, string exe)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(lnkPath)!);

            var shellType = Type.GetTypeFromProgID("WScript.Shell") ?? throw new Exception("WScript.Shell COM type not found");
            var shell     = Activator.CreateInstance(shellType)!;
            var sc        = shell.GetType().InvokeMember("CreateShortcut",
                                BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath })!;
            var t = sc.GetType();
            t.InvokeMember("TargetPath",       BindingFlags.SetProperty, null, sc, new object[] { exe });
            t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { Root });
            t.InvokeMember("IconLocation",     BindingFlags.SetProperty, null, sc, new object[] { $"{exe},0" });
            t.InvokeMember("Description",      BindingFlags.SetProperty, null, sc, new object[] { "Native Share — QuickShare & Claude AI" });
            t.InvokeMember("Save",             BindingFlags.InvokeMethod, null, sc, null);

            LogInstall($"Shortcut OK: {lnkPath} -> {exe}");
        }
        catch (Exception ex)
        {
            LogInstall($"Shortcut FAILED: {lnkPath} :: {ex}");
        }
    }

    static void LogInstall(string message)
    {
        try
        {
            var dir = Path.Combine(Root, "dist");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "install.log"), $"[{DateTime.Now:u}] {message}\n");
        }
        catch { /* logging itself must never crash the launcher */ }
    }

    // ── Web server ───────────────────────────────────────────────────────────

    static void StartWeb()
    {
        try
        {
            KillPort(3000);

            var logPath = Path.Combine(Root, "dist", "web.log");
            Directory.CreateDirectory(Path.Combine(Root, "dist"));
            File.WriteAllText(logPath, $"[{DateTime.Now}] Starting Next.js in {Root}\n");

            var psi = new ProcessStartInfo("cmd.exe")
            {
                Arguments        = $"/c \"cd /d \"{Root}\" && npm run dev -- --hostname 0.0.0.0 --port {Port} >> \"{logPath}\" 2>&1\"",
                UseShellExecute  = false,
                CreateNoWindow   = true,
                WorkingDirectory = Root,
            };

            // Merge machine + user PATH so npm/node are found when launched from a shortcut
            var sys  = Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine) ?? "";
            var user = Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User)    ?? "";
            psi.Environment["PATH"] = $"{sys};{user}";

            psi.Environment["HOST_AGENT_TOKEN"] = "native-dev-token";
            LoadDotEnv(Path.Combine(Root, ".env.local"), psi);

            _web = Process.Start(psi);
        }
        catch (Exception ex)
        {
            // Never let this take down the whole launcher — WaitAndOpenBrowser will
            // just keep polling port 3000 and time out gracefully if it never comes up.
            LogInstall($"StartWeb FAILED: {ex}");
        }
    }

    static void LoadDotEnv(string envPath, ProcessStartInfo psi)
    {
        if (!File.Exists(envPath)) return;
        foreach (var line in File.ReadAllLines(envPath))
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

    // ── Host agent ───────────────────────────────────────────────────────────

    static void StartAgent()
    {
        try
        {
            var exe = FindHostAgentExe();

            ProcessStartInfo psi = exe != null
                ? new ProcessStartInfo { FileName = exe, UseShellExecute = true,
                                         WorkingDirectory = Path.Combine(Root, "host-agent") }
                : new ProcessStartInfo { FileName = "dotnet",
                                         Arguments = "run --project host-agent/host-agent.csproj -c Release",
                                         WorkingDirectory = Root, UseShellExecute = false, CreateNoWindow = true };

            // host-agent.exe carries a requireAdministrator manifest, so the built-exe
            // branch above needs UseShellExecute = true to trigger the UAC prompt — and
            // .NET forbids setting Environment on a ShellExecute'd process. AgentConfig's
            // built-in defaults already match these values, so just skip them there.
            if (!psi.UseShellExecute)
            {
                psi.Environment["CONTROL_PLANE_URL"]             = LocalUrl;
                psi.Environment["HOST_AGENT_TOKEN"]              = "native-dev-token";
                psi.Environment["HOST_AGENT_ID"]                 = "host-main";
                psi.Environment["HOST_AGENT_LABEL"]              = "Main Host";
                psi.Environment["HOST_AGENT_POLL_INTERVAL_SECS"] = "5";
            }

            _agent = Process.Start(psi);
        }
        catch (Exception ex)
        {
            // Never let a host-agent failure (e.g. UAC declined) take down the whole
            // launcher — the web app and browser should still come up without it.
            LogInstall($"StartAgent FAILED: {ex}");
        }
    }

    // ── Browser ──────────────────────────────────────────────────────────────

    static async Task WaitAndOpenBrowser()
    {
        // TCP check: wait until port 3000 accepts connections
        for (int i = 0; i < 30; i++)
        {
            await Task.Delay(2000);
            try
            {
                using var tcp = new TcpClient();
                await tcp.ConnectAsync("127.0.0.1", int.Parse(Port));
                break; // success — server is up
            }
            catch { }
        }

        OpenBrowser();
    }

    static void OpenBrowser(string path = "/")
    {
        var url = $"{LocalUrl}{path}";
        // explorer.exe always opens URLs in the default browser — most reliable on Windows
        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe", url) { UseShellExecute = false });
            return;
        }
        catch { }

        // Fallback
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { }
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────

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
        try { if (p is { HasExited: false }) { p.Kill(true); p.WaitForExit(3000); } }
        catch { }
    }

    static void KillPort(int port)
    {
        try
        {
            Process.Start(new ProcessStartInfo("cmd.exe",
                $"/c for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :{port}') do taskkill /F /PID %a")
            { UseShellExecute = false, CreateNoWindow = true })?.WaitForExit(3000);
        }
        catch { }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    static string GetLanIP()
    {
        foreach (var iface in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (iface.OperationalStatus != OperationalStatus.Up) continue;
            foreach (var addr in iface.GetIPProperties().UnicastAddresses)
                if (addr.Address.AddressFamily == AddressFamily.InterNetwork
                    && !System.Net.IPAddress.IsLoopback(addr.Address))
                    return addr.Address.ToString();
        }
        return "localhost";
    }

    // The exact bin/ subfolder for host-agent.exe depends on how it was built —
    // a bare "dotnet publish" (framework-dependent), a self-contained
    // "-r win-x64 --self-contained" publish (installer builds), or even a plain
    // build output — each lands under a different target-framework/RID/publish
    // path. Search instead of hardcoding one, preferring a self-contained
    // "publish" output (no .NET runtime dependency) and the most recently built.
    static string? FindHostAgentExe()
    {
        var releaseDir = Path.Combine(Root, "host-agent", "bin", "Release");
        if (!Directory.Exists(releaseDir)) return null;

        var matches = Directory.GetFiles(releaseDir, "host-agent.exe", SearchOption.AllDirectories);
        if (matches.Length == 0) return null;

        var publishSep = $"{Path.DirectorySeparatorChar}publish{Path.DirectorySeparatorChar}";
        return matches
            .OrderByDescending(p => p.Contains(publishSep, StringComparison.OrdinalIgnoreCase) ? 1 : 0)
            .ThenByDescending(File.GetLastWriteTimeUtc)
            .First();
    }

    static string FindRoot()
    {
        var exeDir = Path.GetDirectoryName(Environment.ProcessPath ?? AppContext.BaseDirectory)
                     ?? AppContext.BaseDirectory;
        for (var dir = exeDir; dir != null; dir = Path.GetDirectoryName(dir))
            if (File.Exists(Path.Combine(dir, "package.json"))) return dir;
        return Path.GetFullPath(Path.Combine(exeDir, ".."));
    }
}
