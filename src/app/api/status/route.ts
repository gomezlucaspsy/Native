import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    name: "Native Share Cloud",
    deployment: "vercel-ready",
    surfaces: ["dashboard", "guest-portal", "future-pwa"],
    architecture: {
      webApp: "nextjs",
      localAgent: "planned",
      ai: process.env.ANTHROPIC_API_KEY ? "configured" : "not-configured",
    },
  });
}