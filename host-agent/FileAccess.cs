using System.Text;
using System.Text.Json;

// Sandboxed file access for the "Claude reads My Computer" feature.
//
// Claude (via /api/ai/chat tool calls) can ask the host agent to list a
// directory or read a file's contents, so it can ground answers in the
// user's own documents — similar to how NotebookLM grounds answers in
// uploaded sources. All access is confined to HOST_AGENT_SHARED_ROOT; the
// agent never exposes the rest of the filesystem.
internal static class FileAccess
{
    // Deliberately text-only — this feeds an LLM prompt, not a file transfer.
    // Keeps binaries (images, archives, executables) out of Claude's context.
    static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".txt", ".md", ".markdown", ".json", ".yml", ".yaml", ".xml", ".csv",
        ".log", ".ini", ".cfg", ".conf",
        ".cs", ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs",
        ".html", ".css", ".sql", ".sh", ".ps1",
    };

    const int MaxListEntries = 200;
    const int MaxReadBytes = 200_000; // ~200 KB of text is plenty of context per turn

    public static (bool ok, string output) List(Dictionary<string, JsonElement>? payload, string sharedRoot)
    {
        var relativePath = ReadPathArg(payload);

        if (!TryResolve(sharedRoot, relativePath, out var fullPath, out var error))
            return (false, error!);

        if (!Directory.Exists(fullPath))
            return (false, $"'{relativePath}' is not a directory");

        try
        {
            var entries = new List<string>();
            foreach (var dir in Directory.EnumerateDirectories(fullPath).OrderBy(d => d))
            {
                if (IsHidden(dir)) continue;
                entries.Add($"{Path.GetFileName(dir)}/");
                if (entries.Count >= MaxListEntries) break;
            }
            foreach (var file in Directory.EnumerateFiles(fullPath).OrderBy(f => f))
            {
                if (IsHidden(file)) continue;
                var info = new FileInfo(file);
                entries.Add($"{Path.GetFileName(file)}  ({info.Length} bytes)");
                if (entries.Count >= MaxListEntries) break;
            }

            if (entries.Count == 0)
                return (true, "(empty directory)");

            var truncated = entries.Count >= MaxListEntries ? "\n… (truncated)" : "";
            return (true, string.Join("\n", entries) + truncated);
        }
        catch (Exception ex)
        {
            return (false, $"could not list '{relativePath}': {ex.Message}");
        }
    }

    public static (bool ok, string output) Read(Dictionary<string, JsonElement>? payload, string sharedRoot)
    {
        var relativePath = ReadPathArg(payload);
        if (string.IsNullOrWhiteSpace(relativePath))
            return (false, "path is required");

        if (!TryResolve(sharedRoot, relativePath, out var fullPath, out var error))
            return (false, error!);

        if (!File.Exists(fullPath))
            return (false, $"'{relativePath}' does not exist");

        var ext = Path.GetExtension(fullPath);
        if (!AllowedExtensions.Contains(ext))
            return (false, $"'{relativePath}' has an unsupported file type ({ext}); only text/code/doc files can be read");

        try
        {
            var info = new FileInfo(fullPath);
            using var stream = new FileStream(fullPath, FileMode.Open, System.IO.FileAccess.Read, FileShare.ReadWrite);
            var buffer = new byte[Math.Min(info.Length, MaxReadBytes)];
            var read = stream.Read(buffer, 0, buffer.Length);
            var text = Encoding.UTF8.GetString(buffer, 0, read);

            if (info.Length > MaxReadBytes)
                text += $"\n… (truncated, showing first {MaxReadBytes / 1000}KB of {info.Length / 1000}KB)";

            return (true, text);
        }
        catch (Exception ex)
        {
            return (false, $"could not read '{relativePath}': {ex.Message}");
        }
    }

    static string? ReadPathArg(Dictionary<string, JsonElement>? payload)
    {
        if (payload is null) return "";
        if (!payload.TryGetValue("path", out var value)) return "";
        return value.ValueKind == JsonValueKind.String ? value.GetString() : "";
    }

    static bool IsHidden(string path)
    {
        var attrs = File.GetAttributes(path);
        return attrs.HasFlag(FileAttributes.Hidden) || attrs.HasFlag(FileAttributes.System);
    }

    static bool TryResolve(string sharedRoot, string? relativePath, out string fullPath, out string? error)
    {
        var root = Path.GetFullPath(sharedRoot);
        var combined = Path.GetFullPath(Path.Combine(root, relativePath ?? ""));

        var withinRoot = combined.Equals(root, StringComparison.OrdinalIgnoreCase)
            || combined.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

        if (!withinRoot)
        {
            fullPath = "";
            error = $"'{relativePath}' is outside the shared root";
            return false;
        }

        fullPath = combined;
        error = null;
        return true;
    }
}
