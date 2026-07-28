# Native Share

> QuickShare file transfer, a "My Computer" host-agent dashboard, and Claude AI.
> Built in **TypeScript / Next.js** (web + API) and **C# .NET 8** (Windows host agent + desktop launcher).

**Live:** [native-wkh7.vercel.app](https://native-wkh7.vercel.app) · **Local:** `http://localhost:3000`

---

## Install

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

One command: installs npm deps, builds the host agent + launcher, and creates
**Desktop** and **Start Menu** shortcuts ("Native Share") pointed at the built
exe — no need to hunt for `dist/NativeShare.exe` or run it once first.

After that, launch from either shortcut, or:

```
dist/NativeShare.exe
```

The launcher starts Next.js, the C# agent, and opens the browser automatically.
It also (re)creates the same Desktop/Start Menu shortcuts on every launch —
failures are logged to `dist/install.log` instead of failing silently.

---

## What it does

| Tab | Feature | How |
|---|---|---|
| **MY COMPUTER** | See the host agent's online/offline status, rename it, or forget it | CRUD over the agent record: create+read via register/heartbeat, update (rename) via `PUT /api/computer/:id`, delete (forget) via `DELETE /api/computer/:id` |
| **QUICKSHARE** | Drag-drop any file → QR code + direct link | Saved to disk locally, Vercel Blob in production |
| **CLAUDE** | Chat assistant aware of the host computer & shared files, and able to browse/read files on My Computer to ground answers in your own documents (NotebookLM-style) | Anthropic `claude-haiku-4-5` via `/api/ai/chat`, tool calls dispatched as `list_files`/`read_file` agent commands |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Browser  →  Next.js UI  (React 19 · TypeScript)        │
│               Tabs: My Computer · Share · Claude         │
└───────────────────┬──────────────────────────────────────┘
                    │  fetch() — REST JSON
        ┌───────────┴──────────┐
        │  Next.js API Routes  │  /api/**  (Vercel or localhost:3000)
        └───────────┬──────────┘
                    │  HTTP polling — Bearer token auth
┌───────────────────┴──────────────────────────────────────┐
│  C# Host Agent  (host-agent/  ·  .NET 8 console)        │
│  Runs on the Windows machine as "My Computer".          │
│  Registers, heartbeats, polls/executes queued commands. │
└──────────────────────────────────────────────────────────┘
        ↑ launched by
┌───────────────────────────────────────────────────────────┐
│  C# Desktop Launcher  (launcher/  ·  WinForms tray app)  │
│  Single .exe — starts Next.js + agent, tray icon, mutex. │
└───────────────────────────────────────────────────────────┘
```

---

## Codebase map

```
Native/
├── src/                          TypeScript — web UI + all API logic
│   ├── app/
│   │   ├── page.tsx              ← Main UI: 4-tab React component
│   │   ├── globals.css           ← Terminal aesthetic (black / #39ff14 green)
│   │   ├── layout.tsx            ← IBM Plex Mono font, metadata
│   │   └── api/
│   │       ├── status/           GET  — health check + agent count
│   │       ├── computer/[id]/    PUT/DELETE  — rename / forget "My Computer"
│   │       ├── share/            GET/POST  — QuickShare upload + QR
│   │       ├── share/[id]/       DELETE  — remove shared file
│   │       ├── ai/
│   │       │   ├── chat/         POST  — Claude proxy (haiku-4-5)
│   │       │   └── status/       GET   — AI config check
│   │       ├── agent/
│   │       │   ├── register/     POST  — agent registers on boot
│   │       │   ├── heartbeat/    POST  — agent keepalive (45s timeout)
│   │       │   ├── commands/     GET (agent polls) / POST (UI enqueues)
│   │       │   └── command-result/ POST  — agent reports outcome
│   │       └── control/
│   │           └── state/        GET  — full snapshot: agents + commands
│   └── lib/
│       └── control-plane.ts      ← In-memory store (globalThis singleton)
│
├── host-agent/                   C# .NET 8 — Windows host agent ("My Computer")
│   ├── Program.cs                ← Agent loop: register → heartbeat → execute
│   ├── ControlPlane.cs           ← HTTP client for the control-plane API
│   ├── AgentConfig.cs            ← Env/CLI config + derived endpoint URLs
│   ├── FileAccess.cs             ← Sandboxed list/read for Claude's file-context tools
│   ├── host-agent.csproj         ← net8.0-windows
│   └── app.manifest              ← asInvoker (no elevation needed)
│
├── launcher/                     C# .NET 8 — One-click desktop launcher
│   ├── Program.cs                ← WinForms tray app, starts Node + agent, shortcuts
│   ├── NativeLauncher.csproj     ← WinExe, PublishSingleFile, win-x64
│   └── icon.ico                  ← Multi-res glyph, neon green on black
│
├── install.ps1                   ← One-command installer: deps + builds + shortcuts
│
├── dist/
│   ├── NativeShare.exe           ← Built single self-contained launcher exe
│   └── install.log               ← Shortcut creation log (success/failure)
│
├── public/
│   └── shares/                   ← Local QuickShare file storage
│
├── .env.local                    ← Local secrets (not committed)
├── .env.example                  ← Template for new contributors
└── vercel.json                   ← Vercel deployment config (Next.js)
```

---

## Language blocks explained

### 1. TypeScript / Next.js — `src/`

**Runtime:** Node.js (Vercel serverless or local dev server)

#### `src/app/page.tsx` — UI
Single React component, no external UI library. Three tab views controlled by `useState<Tab>`.

- **My Computer tab** — reads the registered host agent from `GET /api/control/state` (polled every 5 s), shows an online/offline pill derived from `lastSeenAt`. Rename via `PUT /api/computer/:id`, forget via `DELETE /api/computer/:id` (the agent re-registers on its next heartbeat, since a 404 heartbeat triggers `RegisterAsync()` again on the C# side).
- **Share tab** — `FormData` POST to `/api/share`, receives `{ url, qr }` back. Renders the QR as an `<img src={dataUrl}>`. Drag-and-drop via `onDrop` + a separate BROWSE button (separate to avoid click conflicts).
- **Claude tab** — Builds a `Message[]` array (user-first enforced), sends to `/api/ai/chat`, streams reply into chat bubbles. Welcome message is display-only, never sent to the API.

#### `src/lib/control-plane.ts` — Shared state
In-memory store using a `globalThis.nativeControlPlaneStore` singleton so it survives Next.js hot-reload between requests. Key exports:
- `upsertAgent(input)` — registers or updates an agent, marks online
- `heartbeatAgent(agentId)` — refreshes `lastSeenAt`; agents go **offline** after 45 000 ms without a heartbeat
- `renameAgent(agentId, label)` — updates the display label (My Computer rename)
- `removeAgent(agentId)` — deletes the agent + its command queue (My Computer "forget")
- `getOnlineAgent()` — returns the first online agent, used by the Claude tool loop to target file commands
- `enqueueCommand(input)` — creates a queued command, returns it
- `dispatchPendingCommands(agentId)` — returns queued commands and marks them `dispatched`
- `completeCommand(...)` — marks command `completed` or `failed`, stores result string
- `waitForCommand(agentId, commandId, timeoutMs)` — polls the store until a command reaches `completed`/`failed` or the timeout elapses; used to turn the async agent-poll round trip into something the Claude tool loop can `await`
- `snapshotState()` — returns all agents + all commands flattened, used by `/api/control/state`

#### `src/app/api/share/route.ts` — QuickShare storage strategy
Detects `process.env.BLOB_READ_WRITE_TOKEN` at runtime:
- **Present (Vercel):** uses `@vercel/blob` → `put(filename, file, { access: "public" })` → returns CDN URL
- **Absent (local):** writes to `public/shares/`, URL is `http://<host>/shares/<filename>` (served by Next.js static)

QR code is generated with the `qrcode` npm package, coloured `#39ff14` on `#0a0a0a`, returned as a base64 data URL embedded in the JSON response.

#### `src/app/api/ai/chat/route.ts` — Claude proxy + "read My Computer" tool loop
Model: `claude-haiku-4-5` (cheapest Anthropic model, sufficient for these assistant tasks).
- Filters empty messages before sending
- Enforces `user`-first message order (Anthropic API requirement)
- System prompt: computer status + shared-file context, concise mode
- Passes two tools to Claude — `list_computer_files` and `read_computer_file` — so it can ground answers in the user's own documents, NotebookLM-style, instead of only chatting generically
- On a `tool_use` stop reason: picks `getOnlineAgent()`, enqueues a `list_files`/`read_file` command with the requested `path`, and `await waitForCommand(...)` (40s timeout — the host agent's default poll interval is 15s, so this needs headroom) before feeding the result back as a `tool_result` and looping (capped at 6 tool turns)
- If no agent is online, or the command times out/fails, the tool result reports that back to Claude as an error so it can tell the user rather than hallucinate file contents
- Returns `{ reply: string }` or `{ error: string }` with HTTP 500

#### `src/app/api/computer/[id]/route.ts` — "My Computer" CRUD
- `PUT { label }` — renames the agent record (`renameAgent`)
- `DELETE` — forgets the agent (`removeAgent`); the host agent transparently re-registers itself on its next heartbeat tick, since a 404 from `/api/agent/heartbeat` makes the C# side call `RegisterAsync()` again

---

### 2. C# .NET 8 — `host-agent/`

**Runtime:** Windows console app. No admin elevation required.

#### Boot sequence (`Program.cs` top-level statements)
```
1. Single-instance mutex guard  — exits if another instance is already running
2. AgentConfig.FromEnvironment(args)  — reads env vars, supports --once CLI flag
3. RegisterAsync()  — POST /api/agent/register
4. Loop every HOST_AGENT_POLL_INTERVAL_SECS (default 15):
     HeartbeatAsync()      POST /api/agent/heartbeat  (404 → re-register)
     PollCommandsAsync()   GET  /api/agent/commands?agentId=...
     foreach command → dispatch by cmd.Type → ReportAsync(result)
```

#### Command dispatch
| Command type | Behavior |
|---|---|
| `sync_media` | *(stub)* — returns "enqueued", extensible for future features |
| `list_files` | `FileAccess.List` — lists a directory under `HOST_AGENT_SHARED_ROOT` (top-level entries, dirs first, capped at 200) |
| `read_file` | `FileAccess.Read` — reads a text/code/doc file under `HOST_AGENT_SHARED_ROOT` (capped at 200 KB, unsupported extensions rejected) |
| *(anything else)* | Reported back as `unsupported command` |

#### `FileAccess.cs` — sandboxed file access for Claude's tools
Backs the `list_files`/`read_file` commands above. Both resolve the requested `path` against `HOST_AGENT_SHARED_ROOT` with `Path.GetFullPath` and reject anything that escapes the root (blocks `..` traversal). `Read` additionally rejects hidden/system entries and any extension not in a text/code/doc allowlist (`.txt`, `.md`, `.json`, `.cs`, `.ts`, …) — this feeds an LLM prompt, not a file transfer, so binaries (images, archives, executables) are deliberately kept out of Claude's context.

#### Environment variables
| Variable | Default | Purpose |
|---|---|---|
| `CONTROL_PLANE_URL` | `http://localhost:3000` | Next.js app URL |
| `HOST_AGENT_TOKEN` | `native-dev-token` | Bearer token (must match web) |
| `HOST_AGENT_ID` | `host-main` | Unique agent ID shown in UI |
| `HOST_AGENT_LABEL` | `Main Host` | Display name |
| `HOST_AGENT_POLL_INTERVAL_SECS` | `15` | Polling frequency |
| `HOST_AGENT_SHARED_ROOT` | Windows `MyDocuments` folder | Root folder Claude may browse/read via `list_computer_files`/`read_computer_file` |

---

### 3. C# .NET 8 WinForms — `launcher/`

**Runtime:** Windows desktop app, single self-contained exe (`PublishSingleFile=true`, `SelfContained=true`, `win-x64`).

#### What it does (`Program.cs`)
1. **Mutex guard** — only one instance; if already running, opens the browser and exits
2. **Tray icon** — loads `icon.ico` from embedded resource, falls back to `SystemIcons.Application`
3. **`StartWeb()`** — kills anything on port 3000 via `netstat/taskkill`, then spawns `npx next dev --hostname 0.0.0.0 --port 3000` with env vars forwarded from the launcher's own environment
4. **`StartAgent()`** — prefers the pre-built `host-agent.exe` (Release build), falls back to `dotnet run`. Uses `UseShellExecute=true` so the agent's UAC manifest triggers the elevation prompt
5. **`WaitAndOpenBrowser()`** — polls `GET /api/status` every 2 s for up to 90 s, opens `http://localhost:3000` on first 200 OK
6. **`FindRoot()`** — walks up the directory tree from `AppContext.BaseDirectory` looking for `package.json` to locate the Next.js root (works whether launched from `dist/`, a shortcut, or any path)
7. **Tray menu** — Open Dashboard · Restart Services · Exit
8. **`Exit()`** — hides tray, calls `StopAll()` (kills Node process + agent), then `Application.Exit()`

#### Build command
```powershell
cd launcher
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o ../dist
```
Output: `dist/NativeShare.exe` (~154 MB, includes .NET 8 runtime).

---

## Running manually (without the launcher)

### Web app
```powershell
cd Native
# Copy and fill in secrets
cp .env.example .env.local

npm install
npm run dev
# → http://localhost:3000  (also on LAN: http://192.168.x.x:3000)
```

### C# host agent (separate terminal)
```powershell
cd Native/host-agent
$env:CONTROL_PLANE_URL            = "http://localhost:3000"
$env:HOST_AGENT_TOKEN             = "native-dev-token"
$env:HOST_AGENT_ID                = "host-main"
$env:HOST_AGENT_LABEL             = "Main Host"
$env:HOST_AGENT_POLL_INTERVAL_SECS = "5"
dotnet run
```

---

## Environment variables

```env
# .env.local — never committed

ANTHROPIC_API_KEY=sk-ant-...          # Claude AI (required for chat tab)
HOST_AGENT_TOKEN=native-dev-token     # Shared secret between web and agent
BLOB_READ_WRITE_TOKEN=vercel_blob_... # Optional — enables Vercel Blob for QuickShare
BLOB_STORE_ID=store_...               # Set automatically when Blob store is linked
HOST_AGENT_SHARED_ROOT=C:\Users\you\Documents  # Optional — folder Claude may browse/read (host-agent side, defaults to Documents)
```

---

## Vercel deployment

- Push to `main` → auto-deploys to `native-wkh7.vercel.app`
- All env vars (`ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`) are set in the Vercel dashboard under **Settings → Environment Variables**
- The `native` Blob store is already linked to the project (`store_gNCKe0YsMU3d3mT0`)
- The C# agent always runs locally — it needs direct Windows WiFi adapter access

---

## Tech stack

| Layer | Technology | Version |
|---|---|---|
| UI framework | Next.js App Router | 16.x |
| UI language | TypeScript (strict) | 5.x |
| UI library | React | 19.x |
| Styling | Tailwind CSS 4 + custom CSS | — |
| AI model | Anthropic Claude Haiku | `claude-haiku-4-5` |
| QR codes | `qrcode` npm package | — |
| File storage (cloud) | Vercel Blob (`@vercel/blob`) | — |
| File storage (local) | Next.js static (`public/shares/`) | — |
| Host agent language | C# .NET 8 console | net8.0-windows |
| Desktop launcher | C# .NET 8 WinForms | net8.0-windows |
| Deployment | Vercel (web) + Windows machine (agent) | — |

---

## Key design decisions (for AI context)

- **In-memory store only** — `control-plane.ts` uses `globalThis` singleton. No database. Commands and agent state reset on server restart. Intentional for simplicity — this is a local tool.
- **Agent is pull-based** — the UI never pushes directly to the agent. It enqueues commands in the web store; the agent polls and pulls them. This means the web app works on Vercel (no direct agent connection needed).
- **QuickShare is dual-path** — same API route, runtime-detected storage backend. `BLOB_READ_WRITE_TOKEN` presence determines cloud vs local.
- **Claude welcome message is UI-only** — it is never sent to the Anthropic API to avoid the "first message must be user" constraint.
- **Launcher uses `FindRoot()`** — the exe can live anywhere (`dist/`, desktop shortcut, etc.) and still find the Next.js project by walking up looking for `package.json`.
- **Claude model is Haiku** — switched from Opus for cost. System prompt is narrow (computer/file assistant) so Haiku quality is sufficient.
- **"My Computer" reuses agent CRUD, not a new store** — the host agent already registers/heartbeats itself as an `AgentState`. Rename/forget are just `PUT`/`DELETE` on that same record (`/api/computer/:id`); there's no separate "computer" entity in `control-plane.ts`.
- **No elevation required** — Hotspot/Devices (the only features needing `netsh`/firewall access) were removed; `app.manifest` now requests `asInvoker`.
- **Claude reads My Computer through the existing pull-based command queue, not a new channel** — `list_files`/`read_file` are just more `CommandType`s. The chat route enqueues one, `await`s `waitForCommand(...)`, and feeds the result back to Claude as a `tool_result`. No new transport, no direct web→agent connection.
- **File access is sandboxed and text-only** — reads/lists are confined to `HOST_AGENT_SHARED_ROOT` (path-traversal checked) and `read_file` only serves an allowlisted set of text/code/doc extensions, since the content is going straight into an LLM prompt.
