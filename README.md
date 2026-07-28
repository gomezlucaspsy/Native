# Native Share

> QuickShare file transfer, a "My Computer" host-agent dashboard, and Claude AI.
> Built in **TypeScript / Next.js** (web + API) and **C# .NET 8** (Windows host agent + desktop launcher).

**Live:** [native-wkh7.vercel.app](https://native-wkh7.vercel.app) · **Local:** `http://localhost:3000`

---

## Install

**Recommended — download the installer, no terminal needed:**

1. Go to the [Releases page](https://github.com/gomezlucaspsy/Native/releases/latest) (also linked from the **GITHUB** tab in the app) and download `NativeShareSetup.exe`.
2. Double-click it. It's a normal Windows setup wizard — pick an install folder, optionally check "create a Desktop shortcut" and "launch at Windows startup", click through, done.
3. It adds a proper entry to **Settings → Apps** (with an uninstaller) and puts Native Share in your Start Menu — no more hunting for a bare `.exe` someone dropped in a folder.
4. The only prerequisite is [Node.js](https://nodejs.org) (LTS) — the installer checks for it and tells you if it's missing.

The installer is built by [`.github/workflows/release.yml`](.github/workflows/release.yml) from [`installer/NativeShare.iss`](installer/NativeShare.iss) (Inno Setup) — it bundles the prebuilt launcher, a self-contained host agent, and the web app's dependencies, so end users never need the .NET SDK or to run `npm install`/`dotnet publish` themselves.

**Building from source (for development):**

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

Installs npm deps, builds the host agent + launcher, and creates **Desktop**
and **Start Menu** shortcuts ("Native Share") pointed at the built exe. Launch
from either shortcut, or run `dist/NativeShare.exe` directly.

The launcher starts Next.js, the C# agent, and opens the browser automatically.
It also (re)creates the same Desktop/Start Menu shortcuts on every launch —
failures are logged to `dist/install.log` instead of failing silently.

---

## What it does

| Tab | Feature | How |
|---|---|---|
| **MY COMPUTER** | See the host agent's online/offline status, rename it, or forget it. Also has a **Virtual Files** panel — a sandboxed file system (files/folders, an editor with Ctrl+S) stored in the browser, which Claude can read and write to as well | Agent status is CRUD over the agent record: create+read via register/heartbeat, update (rename) via `PUT /api/computer/:id`, delete (forget) via `DELETE /api/computer/:id`. Virtual Files lives entirely in `localStorage` (`src/lib/virtual-fs.ts`) |
| **QUICKSHARE** | Drag-drop any file → QR code + direct link. Optionally also push the same file to Google Drive if connected | Saved to disk locally, Vercel Blob in production; Drive copy via `uploadFileToDrive()` |
| **CONNECT** | Pair a phone (or any browser) by scanning a QR code — it shows up in a persistent, renameable "devices" list (online/offline like My Computer). Also where you connect a Google account for the Drive hand-off above | QR encodes `/pair`, which registers a `deviceId` (stored in the phone's `localStorage`) via `POST /api/device/register`, then heartbeats every 15s while a tab is open. Google is a standard OAuth2 authorization-code flow against `/api/google/auth` → `/api/google/callback` |
| **CLAUDE** | Chat assistant aware of the host computer, shared files, and the Virtual Files tree — can create/update/delete virtual files on request | Anthropic `claude-haiku-4-5` via `/api/ai/chat` |
| **GITHUB ↗** | Opens the [source repo](https://github.com/gomezlucaspsy/Native) in a new tab — releases, issues, downloads | Plain external link, not an app tab |

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
│   │   ├── page.tsx              ← Main UI: 3-tab React component + external GITHUB link
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
│   │       ├── device/
│   │       │   ├── register/     POST  — phone/browser pairs itself (from /pair)
│   │       │   ├── heartbeat/    POST  — paired device keepalive (30s timeout)
│   │       │   ├── [id]/         PUT/DELETE  — rename / forget a paired device
│   │       │   └── pair-qr/      GET   — QR code + URL for the CONNECT tab
│   │       ├── google/
│   │       │   ├── auth/         GET  — redirects to Google's OAuth consent screen
│   │       │   ├── callback/     GET  — exchanges code for tokens, stores connection
│   │       │   ├── status/       GET  — { configured, connected, email }
│   │       │   └── disconnect/   POST — clears the stored Google connection
│   │       └── control/
│   │           └── state/        GET  — full snapshot: agents + commands + devices
│   ├── pair/
│   │   └── page.tsx              ← Device pairing landing page (scanned via CONNECT QR)
│   ├── components/
│   │   └── FileExplorer.tsx      ← Virtual Files UI (breadcrumbs, list, editor pane)
│   └── lib/
│       ├── control-plane.ts      ← In-memory store (globalThis singleton) — agents + devices
│       ├── google-auth.ts        ← Hand-rolled Google OAuth2 + Drive upload (no googleapis dep)
│       ├── network.ts            ← LAN IP / shareable-origin helpers (used by QuickShare + pairing QR)
│       └── virtual-fs.ts         ← Virtual Files data model — localStorage-backed
│
├── host-agent/                   C# .NET 8 — Windows host agent ("My Computer")
│   ├── Program.cs                ← Agent loop: register → heartbeat → execute
│   ├── ControlPlane.cs           ← HTTP client for the control-plane API
│   ├── AgentConfig.cs            ← Env/CLI config + derived endpoint URLs
│   ├── host-agent.csproj         ← net8.0-windows
│   └── app.manifest              ← asInvoker (no elevation needed)
│
├── launcher/                     C# .NET 8 — One-click desktop launcher
│   ├── Program.cs                ← WinForms tray app, starts Node + agent, shortcuts
│   ├── NativeLauncher.csproj     ← WinExe, PublishSingleFile, win-x64
│   └── icon.ico                  ← Multi-res glyph, neon green on black
│
├── install.ps1                   ← Build-from-source installer: deps + builds + shortcuts
│
├── installer/
│   └── NativeShare.iss           ← Inno Setup script -> NativeShareSetup.exe
│
├── .github/workflows/
│   └── release.yml               ← Builds + publishes NativeShareSetup.exe to Releases
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
Single React component, no external UI library. Four tab views controlled by `useState<Tab>`, plus a fifth nav item (**GITHUB ↗**) that's a plain external `<a>` to the repo rather than a tab.

- **My Computer tab** — reads the registered host agent from `GET /api/control/state` (polled every 5 s), shows an online/offline pill derived from `lastSeenAt`. Rename via `PUT /api/computer/:id`, forget via `DELETE /api/computer/:id` (the agent re-registers on its next heartbeat, since a 404 heartbeat triggers `RegisterAsync()` again on the C# side). Also renders `<FileExplorer>` — the **Virtual Files** panel.
- **Share tab** — `FormData` POST to `/api/share`, receives `{ url, qr }` back. Renders the QR as an `<img src={dataUrl}>`. Drag-and-drop via `onDrop` + a separate BROWSE button (separate to avoid click conflicts). If Google Drive is connected, an extra checkbox sends `toDrive=1` in the same form.
- **Connect tab** — shows the pairing QR (`GET /api/device/pair-qr`) and the live devices list (from `GET /api/control/state`, polled every 5 s), plus the Google account row (`GET /api/google/status`). Renaming a device is inline (click the label → input → Enter/blur to save), same interaction as My Computer's rename.
- **Claude tab** — Builds a `Message[]` array (user-first enforced), sends to `/api/ai/chat` along with `fsTree(fsLoad())` as extra context. If the reply ends with a fenced `` ```file-action `` JSON block, `extractFileAction()` strips it from the displayed text and applies it to the Virtual Files store.

#### `src/lib/virtual-fs.ts` + `src/components/FileExplorer.tsx` — Virtual Files
A sandboxed filesystem that exists only in the browser's `localStorage` (key `native:vfs`) — no server, no database, inspired by the "mycomputer" file explorer in [personaforge](https://github.com/gomezlucaspsy/personaforge). `virtual-fs.ts` holds the pure data functions (`fsLoad`/`fsSave`/`fsList`/`fsTree`/`fsApplyAction`); `FileExplorer.tsx` is the two-pane UI (folder list + editor) built from the same terminal-aesthetic CSS classes as the rest of the app. Claude can act on it too — see the `chat`/`ai/chat` flow above.

#### `src/lib/control-plane.ts` — Shared state
In-memory store using a `globalThis.nativeControlPlaneStore` singleton so it survives Next.js hot-reload between requests. Key exports:
- `upsertAgent(input)` — registers or updates an agent, marks online
- `heartbeatAgent(agentId)` — refreshes `lastSeenAt`; agents go **offline** after 45 000 ms without a heartbeat
- `renameAgent(agentId, label)` — updates the display label (My Computer rename)
- `removeAgent(agentId)` — deletes the agent + its command queue (My Computer "forget")
- `enqueueCommand(input)` — creates a queued command, returns it
- `dispatchPendingCommands(agentId)` — returns queued commands and marks them `dispatched`
- `completeCommand(...)` — marks command `completed` or `failed`, stores result string
- `registerDevice(input)` / `heartbeatDevice(deviceId)` / `renameDevice(...)` / `removeDevice(...)` — same CRUD shape as the agent functions, but for paired phones/browsers (30s offline window instead of 45s)
- `snapshotState()` — returns all agents + all commands + all devices flattened, used by `/api/control/state`

#### `src/app/api/share/route.ts` — QuickShare storage strategy
Detects `process.env.BLOB_READ_WRITE_TOKEN` at runtime:
- **Present (Vercel):** uses `@vercel/blob` → `put(filename, file, { access: "public" })` → returns CDN URL
- **Absent (local):** writes to `public/shares/`, URL is `http://<host>/shares/<filename>` (served by Next.js static)

QR code is generated with the `qrcode` npm package, coloured `#39ff14` on `#0a0a0a`, returned as a base64 data URL embedded in the JSON response.

#### `src/app/api/ai/chat/route.ts` — Claude proxy
Model: `claude-haiku-4-5` (cheapest Anthropic model, sufficient for these assistant tasks).
- Filters empty messages before sending
- Enforces `user`-first message order (Anthropic API requirement)
- System prompt: computer status + shared-file context, concise mode
- Returns `{ reply: string }` or `{ error: string }` with HTTP 500

#### `src/app/api/computer/[id]/route.ts` — "My Computer" CRUD
- `PUT { label }` — renames the agent record (`renameAgent`)
- `DELETE` — forgets the agent (`removeAgent`); the host agent transparently re-registers itself on its next heartbeat tick, since a 404 from `/api/agent/heartbeat` makes the C# side call `RegisterAsync()` again

#### `src/app/pair/page.tsx` + `src/lib/control-plane.ts` (devices) — Connect Devices
The CONNECT tab shows a QR code (from `GET /api/device/pair-qr`) encoding `<shareable-origin>/pair`. Scanning it on a phone opens `/pair`, which:
1. Reads/creates a `deviceId` (`crypto.randomUUID()`) in the phone's `localStorage` (`native-device-id`)
2. Guesses a label from `navigator.userAgent` (iPhone / Android Phone / Mac / Windows PC / Device)
3. `POST /api/device/register` — creates a `DeviceState` in the same in-memory store as agents (separate `devices` map)
4. Redirects to `/`, where a heartbeat effect (`POST /api/device/heartbeat` every 15s while any tab from that browser is open) keeps it marked online — devices go **offline** after 30s without a heartbeat (shorter than the host agent's 45s, since a phone stops heartbeating the instant its tab closes)

Rename/forget reuse the same `PUT`/`DELETE /api/device/:id` pattern as "My Computer". `getShareableOrigin()` (`src/lib/network.ts`) picks the right URL for the QR: the Vercel deployment URL in production, or the machine's LAN IP locally (so a phone on the same Wi-Fi can actually reach it — `localhost` wouldn't resolve on the phone).

#### `src/lib/google-auth.ts` + `src/app/api/google/*` — Google Drive account
A minimal OAuth2 authorization-code flow, hand-rolled with `fetch` (no `googleapis` dependency, matching this repo's "no heavy deps" style):
- `GET /api/google/auth` — builds the Google consent URL (`drive.file` + `userinfo.email` scopes, `access_type=offline` for a refresh token), stashes a CSRF `state` nonce, redirects
- `GET /api/google/callback` — validates `state`, exchanges the code for tokens, fetches the connected email, stores the connection
- The connection (access token, refresh token, expiry, email) lives in a `globalThis` singleton, same pattern as `control-plane.ts` — resets on server restart, so reconnecting is a one-click "CONNECT" away
- QuickShare's upload form can pass `toDrive=1`; if Google is connected, `/api/share` also calls `uploadFileToDrive()` (multipart upload to the Drive v3 API) and returns a `driveUrl` alongside the usual QR link
- Requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from a Google Cloud OAuth client (Web application type), with `<origin>/api/google/callback` registered as an authorized redirect URI for every origin you use (e.g. both `http://localhost:3000` and the Vercel production URL)

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
| *(anything else)* | Reported back as `unsupported command` |

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
GOOGLE_CLIENT_ID=...                  # Optional — enables "Connect Google Drive" (CONNECT tab)
GOOGLE_CLIENT_SECRET=...              # Google Cloud OAuth client secret (Web application type)
```

Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, the CONNECT tab still shows Devices; the Google Drive row just displays "Not configured on this deployment" and the CONNECT button is disabled.

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
- **No elevation required** — Hotspot/Devices (the only features needing `netsh`/firewall access) were removed; `app.manifest` now requests `asInvoker`. The current **CONNECT** tab's "devices" are unrelated to that old removed feature — they're just browser tabs that register themselves over HTTP, no OS-level networking access needed.
- **Devices are a lighter-weight sibling of agents, not the same entity** — a paired phone can't run the C# host agent, so it gets its own `DeviceState` + 30s offline window (vs the agent's 45s) in `control-plane.ts`, registered by a plain browser page (`/pair`) instead of a native process.
- **Google connection is single-account, in-memory, no `googleapis` dependency** — this is a personal/local tool, not a multi-tenant app, so one connected Drive account or store db here would be overkill; a small hand-rolled `fetch`-based OAuth2 client matches the project's existing minimal-dependency style and resets on restart same as everything else in `control-plane.ts`.
