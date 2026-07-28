import { NextRequest, NextResponse } from "next/server";
import { heartbeatDevice } from "@/lib/control-plane";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { deviceId?: string } | null;

  if (!body?.deviceId) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  const device = heartbeatDevice(body.deviceId);
  if (!device) {
    return NextResponse.json({ error: "device not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, device });
}
