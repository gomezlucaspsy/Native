# Native Share

A WiFi hotspot manager with QuickShare file transfer and Claude AI — built in **Next.js (TypeScript)** and **C# (.NET 8)**.

Live: [native-wkh7.vercel.app](https://native-wkh7.vercel.app)

---

## What it does

| Feature | Description |
|---|---|
| **Hotspot** | Start / stop a Windows WiFi hotspot from the browser |
| **Devices** | Live list of connected devices with kick (DELETE) |
| **QuickShare** | Drop any file → instant download link + QR code — anyone on the hotspot scans and gets the file |
| **Claude AI** | Chat assistant wired to the Anthropic API, aware of your hotspot and devices |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser  →  Next.js UI (TypeScript / React)    │
│               4 tabs: Hotspot · Devices ·        │
│               QuickShare · Claude                │
└────────────────┬────────────────────────────────┘
                 │  REST API (Next.js App Router)
        ┌────────┴─────────┐
        │  /api/...        │  (runs on Vercel or localhost)
        └────────┬─────────┘
                 │  HTTP polling (Bearer token)
┌────────────────┴────────────────────────────────┐
│  C# Host Agent  (.NET 8 · host-agent/)          │
│  Runs on the Windows machine that owns the      │
│  WiFi adapter. Executes real netsh commands.    │
└─────────────────────────────────────────────────┘
```

---

## Language breakdown

### TypeScript / Next.js — `src/`

Everything the user sees and all server-side API logic lives here.

#### UI — `src/app/page.tsx`
- Single React component with 4 tab views
- `useState` / `useEffect` for local state and polling
- Fetches `/api/devices` every 5 s, renders live results
- Drag-and-drop file upload via `FormData` POST to `/api/share`
- Claude chat: builds a `messages[]` array, sends to `/api/ai/chat`, streams reply into bubbles

#### API routes — `src/app/api/`

| Route | Method | What it does |
|---|---|---|
| `/api/status` | GET | Health check, shows agent count and pending commands |
| `/api/devices` | GET / POST | In-memory device list (CRUD) |
| `/api/devices/[id]` | PUT / DELETE | Update or kick a single device |
| `/api/share` | GET / POST | Upload a file → save to disk (local) or Vercel Blob (cloud) → return URL + green QR data-URL |
| `/api/share/[id]` | DELETE | Remove file from disk / Blob and clear from memory |
| `/api/ai/chat` | POST | Forward conversation to Claude (`claude-opus-4-5`), enforce user-first message order, return `{ reply }` |
| `/api/agent/register` | POST | Agent registers itself on boot |
| `/api/agent/heartbeat` | POST | Agent sends a heartbeat every poll cycle |
| `/api/agent/commands` | GET / POST | Dashboard enqueues commands; agent fetches and marks them dispatched |
| `/api/agent/command-result` | POST | Agent reports success/failure and real output back |
| `/api/control/state` | GET | Full snapshot: agents + all commands — polled by UI to show results |

#### Shared state — `src/lib/control-plane.ts`
- In-memory store using a `globalThis` singleton so it survives Next.js hot-reload
- `upsertAgent` / `enqueueCommand` / `dispatchPendingCommands` / `snapshotState`
- Agents go **offline** automatically after 45 s without a heartbeat

#### QuickShare storage — `src/app/api/share/route.ts`
- **Local**: writes files to `public/shares/`, URL is `http://<host>/shares/<filename>`
- **Vercel**: uses `@vercel/blob` when `BLOB_READ_WRITE_TOKEN` is set — same code path, detected at runtime

---

### C# / .NET 8 — `host-agent/`

The host agent runs on your Windows machine. It is the only component that touches local hardware.

#### `host-agent/Program.cs`

```
Boot
 └─ AgentConfig.FromEnvironment()   reads env vars + CLI args
 └─ RegisterAgentAsync()            POST /api/agent/register
 └─ loop every N seconds:
      SendHeartbeatAsync()          POST /api/agent/heartbeat
      FetchCommandsAsync()          GET  /api/agent/commands?agentId=...
      foreach command:
        ExecuteCommand()            runs real Windows commands
        ReportCommandResultAsync()  POST /api/agent/command-result
```

#### `ExecuteCommand` — maps API command types to real OS calls

| Command type | What runs |
|---|---|
| `start_hotspot` | `netsh wlan start hostednetwork` |
| `stop_hotspot` | `netsh wlan stop hostednetwork` |
| `scan_devices` | `netsh wlan show hostednetwork` |
| `sync_media` | queues a background job (extensible) |

`RunNetsh()` spawns the process, captures stdout/stderr, returns `(bool Success, string Result)` — the result text is sent back to the dashboard and displayed in the Hotspot tab.

#### Configuration via environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CONTROL_PLANE_URL` | `http://localhost:3000` | Where the Next.js app is running |
| `HOST_AGENT_TOKEN` | `native-dev-token` | Bearer token for API auth |
| `HOST_AGENT_ID` | `host-main` | Unique agent identifier |
| `HOST_AGENT_LABEL` | `Main Host` | Display name in the UI |
| `HOST_AGENT_POLL_INTERVAL_SECS` | `15` | How often to poll for commands |

---

## Running locally

### 1. Web app

```bash
npm install
npm run dev
# opens http://localhost:3000
# also reachable on LAN at http://192.168.x.x:3000 for hotspot devices
```

### 2. C# host agent

```bash
cd host-agent

# Windows (required for netsh hotspot commands — run as Administrator)
$env:CONTROL_PLANE_URL = "http://localhost:3000"
$env:HOST_AGENT_TOKEN  = "native-dev-token"
$env:HOST_AGENT_POLL_INTERVAL_SECS = "5"
dotnet run
```

The agent registers, starts heartbeating, and the dashboard shows it **online** within seconds.

### 3. Environment variables

```bash
cp .env.example .env.local
```

```env
ANTHROPIC_API_KEY=sk-ant-...      # Claude AI
HOST_AGENT_TOKEN=native-dev-token # shared secret between agent and web
BLOB_READ_WRITE_TOKEN=...         # optional — Vercel Blob for QuickShare uploads
```

---

## Vercel deployment

The web app deploys automatically from `main`. The C# agent always runs locally — it needs direct access to the Windows WiFi adapter.

To enable QuickShare file hosting on Vercel:
1. Go to your project → **Storage** → create a **Blob** store
2. Copy the `BLOB_READ_WRITE_TOKEN` into **Environment Variables**

The share route detects the token at runtime and switches from local filesystem to Blob storage automatically.

---

## Project structure

```
Native/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Main UI — 4 tabs
│   │   ├── globals.css               # Terminal aesthetic (black/green)
│   │   ├── layout.tsx                # IBM Plex Mono font, metadata
│   │   └── api/
│   │       ├── status/               # App health
│   │       ├── devices/              # Device CRUD
│   │       ├── share/                # QuickShare upload + QR
│   │       ├── ai/chat/              # Claude proxy
│   │       ├── agent/                # Agent register / heartbeat / commands
│   │       └── control/state/        # Full control plane snapshot
│   └── lib/
│       └── control-plane.ts          # In-memory store singleton
├── host-agent/
│   ├── Program.cs                    # C# agent — polls + runs netsh
│   └── host-agent.csproj             # .NET 8 console app
├── public/
│   └── shares/                       # Local QuickShare file storage
├── .env.example
└── package.json
```

---

## Tech stack

| Layer | Technology |
|---|---|
| UI | React 19, Next.js 16 App Router |
| Language | TypeScript (strict) |
| Styles | Tailwind CSS 4 + custom terminal CSS |
| AI | Anthropic Claude (`claude-opus-4-5`) |
| File sharing | Local filesystem / Vercel Blob |
| QR codes | `qrcode` npm package |
| Host agent | C# .NET 8 console app |
| OS integration | `netsh` (Windows WiFi Hosted Network) |
| Deployment | Vercel (web) + local Windows machine (agent) |
