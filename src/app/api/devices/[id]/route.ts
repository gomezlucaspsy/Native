import { NextRequest, NextResponse } from "next/server";
import { devices } from "../route";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const device = devices.find((d) => d.id === id);
  if (!device) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(device);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idx = devices.findIndex((d) => d.id === id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json();
  devices[idx] = { ...devices[idx], ...body, id };
  return NextResponse.json(devices[idx]);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idx = devices.findIndex((d) => d.id === id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });
  devices.splice(idx, 1);
  return NextResponse.json({ deleted: id });
}
