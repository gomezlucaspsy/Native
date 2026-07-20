import { NextRequest, NextResponse } from "next/server";
import { heartbeatAgent } from "@/lib/control-plane";

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
      }
    | null;

  if (!body?.agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const agent = heartbeatAgent(body.agentId);
  if (!agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, agent });
}