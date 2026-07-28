import { NextRequest, NextResponse } from "next/server";
import { removeDevice, renameDevice } from "@/lib/control-plane";

// Paired-device CRUD, mirrors /api/computer/:id — Update (rename) and
// Delete (forget/unpair) on the device record created by /api/device/register.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { label?: string } | null;
  if (!body?.label?.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  const device = renameDevice(id, body.label.trim());
  if (!device) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(device);
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const removed = removeDevice(id);
  if (!removed) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ removed: id });
}
