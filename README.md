# Native Share

> WiFi hotspot manager with QuickShare file transfer and Claude AI.
> Built in **TypeScript / Next.js** (web + API) and **C# .NET 8** (Windows host agent + desktop launcher).

**Live:** [native-wkh7.vercel.app](https://native-wkh7.vercel.app) · **Local:** `http://localhost:3000`

---

## Quick start (one double-click)

```
dist/NativeShare.exe
```

Or from the **"Native Share"** shortcut on the desktop.
The launcher starts Next.js, the C# agent, and opens the browser automatically.

---

## What it does

| Tab | Feature | How |
|---|---|---|
| **HOTSPOT** | Start / stop a Windows WiFi hotspot | C# agent runs `netsh wlan start/stop hostednetwork` |
| **DEVICES** | Live list of connected devices, kick any device | REST CRUD, polls every 5 s |
| **QUICKSHARE** | Drag-drop any file → QR code + direct link | Saved to disk locally, Vercel Blob in production |
| **CLAUDE** | Chat assistant aware of hotspot & devices | Anthropic `claude-haiku-4-5` via `/api/ai/chat` |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Browser  →  Next.js UI  (React 19 · TypeScript)        │
│               Tabs: Hotspot · Devices · Share · Claude   │
└───────────────────┬──────────────────────────────────────┘
                    │  fetch() — REST JSON
        ┌───────────┴──────────┐
        │  Next.js API Routes  │  /api/**  (Vercel or localhost:3000)
        └───────────┬──────────┘
                    │  HTTP polling — Bearer token auth
┌───────────────────┴──────────────────────────────────────┐
│  C# Host Agent  (host-agent/  ·  .NET 8 console)        │
│  Runs on Windows machine that owns the WiFi adapter.    │
│  Executes real netsh commands, reports results back.    │
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
│   │       ├── devices/          GET/POST  — device list CRUD
│   │       ├── devices/[id]/     PUT/DELETE  — single device
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
├── host-agent/                   C# .NET 8 — Windows WiFi controller
│   ├── Program.cs                ← Agent loop: register → heartbeat → execute
│   ├── host-agent.csproj         ← net8.0, requireAdministrator manifest
│   └── app.manifest              ← Forces UAC elevation for netsh
│
├── launcher/                     C# .NET 8 — One-click desktop launcher
│   ├── Program.cs                ← WinForms tray app, starts Node + agent
│   ├── NativeLauncher.csproj     ← WinExe, PublishSingleFile, win-x64
│   └── icon.ico                  ← Green dot on black (embedded resource)
│
├── dist/
│   └── NativeShare.exe           ← Built single self-contained launcher exe
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
Single React component, no external UI library. Four tab views controlled by `useState<Tab>`.

- **Hotspot tab** — calls `POST /api/agent/commands` with `start_hotspot` or `stop_hotspot`, then polls `/api/control/state` every 2 s to show the real `netsh` output returned by the agent.
- **Devices tab** — `GET /api/devices` every 5 s. `DELETE /api/devices/:id` to kick. Handles both `Device[]` and `{ value: Device[] }` response shapes.
- **Share tab** — `FormData` POST to `/api/share`, receives `{ url, qr }` back. Renders the QR as an `<img src={dataUrl}>`. Drag-and-drop via `onDrop` + a separate BROWSE button (separate to avoid click conflicts).
- **Claude tab** — Builds a `Message[]` array (user-first enforced), sends to `/api/ai/chat`, streams reply into chat bubbles. Welcome message is display-only, never sent to the API.

#### `src/lib/control-plane.ts` — Shared state
In-memory store using a `globalThis.nativeControlPlaneStore` singleton so it survives Next.js hot-reload between requests. Key exports:
- `upsertAgent(input)` — registers or updates an agent, marks online
- `sendHeartbeat(agentId)` — refreshes `lastSeenAt`; agents go **offline** after 45 000 ms without a heartbeat
- `enqueueCommand(input)` — creates a queued command, returns it
- `dispatchPendingCommands(agentId)` — returns queued commands and marks them `dispatched`
- `reportCommandResult(...)` — marks command `completed` or `failed`, stores result string
- `snapshotState()` — returns all agents + all commands flattened, used by `/api/control/state`

#### `src/app/api/share/route.ts` — QuickShare storage strategy
Detects `process.env.BLOB_READ_WRITE_TOKEN` at runtime:
- **Present (Vercel):** uses `@vercel/blob` → `put(filename, file, { access: "public" })` → returns CDN URL
- **Absent (local):** writes to `public/shares/`, URL is `http://<host>/shares/<filename>` (served by Next.js static)

QR code is generated with the `qrcode` npm package, coloured `#39ff14` on `#0a0a0a`, returned as a base64 data URL embedded in the JSON response.

#### `src/app/api/ai/chat/route.ts` — Claude proxy
Model: `claude-haiku-4-5` (cheapest Anthropic model, sufficient for hotspot assistant tasks).
- Filters empty messages before sending
- Enforces `user`-first message order (Anthropic API requirement)
- System prompt: hotspot/device/file context, concise mode
- Returns `{ reply: string }` or `{ error: string }` with HTTP 500

---

### 2. C# .NET 8 — `host-agent/`

**Runtime:** Windows console app, must run as Administrator (netsh requirement).

#### Boot sequence (`Program.cs` top-level statements)
```
1. Elevation check  — WindowsPrincipal.IsInRole(Administrator), exits with message if not elevated
2. AgentConfig.FromEnvironment(args)  — reads env vars, supports --once CLI flag
3. RegisterAgentAsync()  — POST /api/agent/register
4. Loop every HOST_AGENT_POLL_INTERVAL_SECS (default 15):
     SendHeartbeatAsync()           POST /api/agent/heartbeat
     FetchCommandsAsync()           GET  /api/agent/commands?agentId=...
     foreach command → ExecuteCommand() → ReportCommandResultAsync()
```

#### `ExecuteCommand` — command → OS mapping
| Command type | Shell call | Notes |
|---|---|---|
| `start_hotspot` | `netsh wlan start hostednetwork` | Requires elevation |
| `stop_hotspot` | `netsh wlan stop hostednetwork` | Requires elevation |
| `scan_devices` | `netsh wlan show hostednetwork` | Returns adapter + client info |
| `sync_media` | *(stub)* | Returns "enqueued", extensible |

`RunNetsh(args)` — spawns `netsh` via `ProcessStartInfo`, redirects stdout/stderr, waits 8 s, returns `(bool Success, string Result)`. The result string is POSTed back to `/api/agent/command-result` and displayed live in the UI Hotspot tab.

#### `app.manifest` — UAC elevation
Embeds `requestedExecutionLevel level="requireAdministrator"` into the exe. Windows shows a UAC prompt on launch. The runtime check in `Program.cs` provides a clear error message as a fallback if somehow bypassed.

#### Environment variables
| Variable | Default | Purpose |
|---|---|---|
| `CONTROL_PLANE_URL` | `http://localhost:3000` | Next.js app URL |
| `HOST_AGENT_TOKEN` | `native-dev-token` | Bearer token (must match web) |
| `HOST_AGENT_ID` | `host-main` | Unique agent ID shown in UI |
| `HOST_AGENT_LABEL` | `Main Host` | Display name |
| `HOST_AGENT_POLL_INTERVAL_SECS` | `15` | Polling frequency |

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

### C# host agent (separate elevated terminal)
```powershell
cd Native/host-agent
$env:CONTROL_PLANE_URL            = "http://localhost:3000"
$env:HOST_AGENT_TOKEN             = "native-dev-token"
$env:HOST_AGENT_ID                = "host-main"
$env:HOST_AGENT_LABEL             = "Main Host"
$env:HOST_AGENT_POLL_INTERVAL_SECS = "5"
dotnet run
# Must be run as Administrator for netsh hotspot commands
```

---

## Environment variables

```env
# .env.local — never committed

ANTHROPIC_API_KEY=sk-ant-...          # Claude AI (required for chat tab)
HOST_AGENT_TOKEN=native-dev-token     # Shared secret between web and agent
BLOB_READ_WRITE_TOKEN=vercel_blob_... # Optional — enables Vercel Blob for QuickShare
BLOB_STORE_ID=store_...               # Set automatically when Blob store is linked
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
| Host agent language | C# .NET 8 console | net8.0 |
| OS integration | Windows `netsh` (WiFi Hosted Network) | — |
| Desktop launcher | C# .NET 8 WinForms | net8.0-windows |
| Deployment | Vercel (web) + Windows machine (agent) | — |

---

## Key design decisions (for AI context)

- **In-memory store only** — `control-plane.ts` uses `globalThis` singleton. No database. Commands and agent state reset on server restart. Intentional for simplicity — this is a local tool.
- **Agent is pull-based** — the UI never pushes directly to the agent. It enqueues commands in the web store; the agent polls and pulls them. This means the web app works on Vercel (no direct agent connection needed).
- **QuickShare is dual-path** — same API route, runtime-detected storage backend. `BLOB_READ_WRITE_TOKEN` presence determines cloud vs local.
- **Claude welcome message is UI-only** — it is never sent to the Anthropic API to avoid the "first message must be user" constraint.
- **Launcher uses `FindRoot()`** — the exe can live anywhere (`dist/`, desktop shortcut, etc.) and still find the Next.js project by walking up looking for `package.json`.
- **Claude model is Haiku** — switched from Opus for cost. System prompt is narrow (hotspot assistant) so Haiku quality is sufficient.
