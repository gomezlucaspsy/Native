import { NextRequest, NextResponse } from "next/server";
import { registerDevice } from "@/lib/control-plane";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { deviceId?: string; label?: string; kind?: string; userAgent?: string }
    | null;

  if (!body?.deviceId) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  const device = registerDevice({
    deviceId: body.deviceId,
    label: body.label ?? "Device",
    kind: body.kind ?? "unknown",
    userAgent: body.userAgent ?? "",
  });

  return NextResponse.json({ ok: true, device });
}
