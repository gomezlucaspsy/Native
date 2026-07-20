import { NextRequest, NextResponse } from "next/server";

export interface Device {
  id: string;
  name: string;
  ip: string;
  mac: string;
  connectedAt: string;
}

declare global {
  var nativeDevices: Device[] | undefined;
}

export const devices: Device[] =
  globalThis.nativeDevices ??
  (globalThis.nativeDevices = [
    { id: "dev-1", name: "iPhone 15", ip: "192.168.137.2", mac: "AA:BB:CC:DD:EE:01", connectedAt: new Date().toISOString() },
    { id: "dev-2", name: "Galaxy S24", ip: "192.168.137.3", mac: "AA:BB:CC:DD:EE:02", connectedAt: new Date().toISOString() },
  ]);

export function GET() {
  return NextResponse.json(devices);
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<Device>;
  const device: Device = {
    id: `dev-${Date.now()}`,
    name: body.name ?? "Unknown",
    ip: body.ip ?? "",
    mac: body.mac ?? "",
    connectedAt: new Date().toISOString(),
  };
  devices.push(device);
  return NextResponse.json(device, { status: 201 });
}
