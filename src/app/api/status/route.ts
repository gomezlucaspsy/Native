import { NextResponse } from "next/server";
import { seedDemoAgentIfEmpty, snapshotState } from "@/lib/control-plane";

export function GET() {
  seedDemoAgentIfEmpty();
  const state = snapshotState();

  return NextResponse.json({
    name: "Native Share Cloud",
    deployment: "vercel-ready",
    surfaces: ["dashboard", "agent-control", "future-pwa"],
    architecture: {
      webApp: "nextjs",
      localAgent: "csharp-host-agent",
      ai: process.env.ANTHROPIC_API_KEY ? "configured" : "not-configured",
    },
    runtime: {
      agents: state.agents.length,
      pendingCommands: state.commands.filter((item) => item.status === "queued").length,
    },
  });
}