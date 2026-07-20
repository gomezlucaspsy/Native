import { NextRequest, NextResponse } from "next/server";
import { seedDemoAgentIfEmpty, upsertAgent } from "@/lib/control-plane";

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.HOST_AGENT_TOKEN || "native-dev-token";
  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  return bearer === expected;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        agentId?: string;
        label?: string;
        platform?: string;
        version?: string;
      }
    | null;

  if (!body?.agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  seedDemoAgentIfEmpty();

  const agent = upsertAgent({
    agentId: body.agentId,
    label: body.label ?? body.agentId,
    platform: body.platform ?? "unknown",
    version: body.version ?? "0.0.0",
  });

  return NextResponse.json({ ok: true, agent });
}