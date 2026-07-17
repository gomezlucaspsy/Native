import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    provider: "claude",
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
    envVar: "ANTHROPIC_API_KEY",
  });
}