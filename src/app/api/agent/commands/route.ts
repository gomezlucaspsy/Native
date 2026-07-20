import { NextRequest, NextResponse } from "next/server";
import {
  dispatchPendingCommands,
  enqueueCommand,
  seedDemoAgentIfEmpty,
} from "@/lib/control-plane";

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.HOST_AGENT_TOKEN || "native-dev-token";
  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  return bearer === expected;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const agentId = request.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const commands = dispatchPendingCommands(agentId);
  return NextResponse.json({ commands });
}

export async function POST(request: NextRequest) {
  seedDemoAgentIfEmpty();

  const body = (await request.json().catch(() => null)) as
    | {
        agentId?: string;
        type?: "scan_devices" | "start_hotspot" | "stop_hotspot" | "sync_media";
        payload?: Record<string, unknown>;
      }
    | null;

  if (!body?.agentId || !body.type) {
    return NextResponse.json(
      { error: "agentId and type are required" },
      { status: 400 },
    );
  }

  const command = enqueueCommand({
    agentId: body.agentId,
    type: body.type,
    payload: body.payload,
  });

  return NextResponse.json({ ok: true, command }, { status: 201 });
}