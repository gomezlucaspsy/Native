import { NextRequest, NextResponse } from "next/server";
import { removeAgent, renameAgent } from "@/lib/control-plane";

// "My Computer" CRUD: the host-agent already Creates/Reads itself via
// /api/agent/register + /api/control/state. These are the browser-facing
// Update (rename) and Delete (forget) verbs on that same agent record.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { label?: string } | null;
  if (!body?.label?.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  const agent = renameAgent(id, body.label.trim());
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(agent);
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const removed = removeAgent(id);
  if (!removed) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ removed: id });
}
