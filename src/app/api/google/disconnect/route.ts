import { NextResponse } from "next/server";
import { disconnect } from "@/lib/google-auth";

export function POST() {
  disconnect();
  return NextResponse.json({ ok: true });
}
