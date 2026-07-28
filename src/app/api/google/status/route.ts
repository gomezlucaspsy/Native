import { NextResponse } from "next/server";
import { getConnection, isGoogleConfigured } from "@/lib/google-auth";

export function GET() {
  return NextResponse.json({ configured: isGoogleConfigured(), ...getConnection() });
}
