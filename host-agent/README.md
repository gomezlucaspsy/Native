# Host Agent

C# .NET 8 console app that runs on the Windows machine hosting Native Share.
Registers itself with the web app's control plane and stays reachable as
"My Computer".

## Current capability

- authenticated registration at `/api/agent/register`
- periodic heartbeat at `/api/agent/heartbeat`
- polling command queue at `/api/agent/commands`
- reporting execution results at `/api/agent/command-result`

## Run locally

From the repository root:

```powershell
npm run dev
```

In another shell:

```powershell
cd host-agent
$env:CONTROL_PLANE_URL = "http://localhost:3000"
$env:HOST_AGENT_TOKEN  = "native-dev-token"
dotnet run -- --once
```

## Configuration

- `CONTROL_PLANE_URL`: base URL of the control plane, default `http://localhost:3000`
- `HOST_AGENT_TOKEN`: bearer token for control plane auth, default `native-dev-token`
- `HOST_AGENT_ID`: identifier, default `host-main`
- `HOST_AGENT_LABEL`: label in dashboard, default `Main Host`
- `HOST_AGENT_PLATFORM`: override platform label, default OS name
- `HOST_AGENT_VERSION`: runtime version, default `0.1.0`
- `HOST_AGENT_POLL_INTERVAL_SECS`: seconds between polls, default `15`
- `dotnet run -- --once`: perform one poll and exit
