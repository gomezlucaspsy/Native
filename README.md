# Native Share Cloud

A Vercel-ready Next.js control plane for a hybrid sharing system:

- web dashboard hosted online
- local host agent for hotspot and device-level actions
- guest upload portal for phones and laptops
- Claude-ready API hooks for safe orchestration later

## Stack

- Next.js 16 App Router
- TypeScript
- Tailwind CSS 4
- Vercel deployment target

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Claude configuration

Claude is optional in this scaffold.

Create a local env file when you are ready to enable AI features:

```bash
cp .env.example .env.local
```

Then set:

```bash
ANTHROPIC_API_KEY=your_key_here
```

## Included routes

- `/` product shell landing page
- `/api/status` app capability summary
- `/api/ai/status` Claude configuration status

## Architecture direction

The web app is intentionally separate from the future local host agent. That split lets you deploy the dashboard to Vercel while keeping hotspot control, local file access, and LAN-device features in a companion process on supported machines.
