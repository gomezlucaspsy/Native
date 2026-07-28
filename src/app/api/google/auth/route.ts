import { NextRequest, NextResponse } from "next/server";
import { createAuthUrl, isGoogleConfigured } from "@/lib/google-auth";

export async function GET(request: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: "Google is not configured (missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET)" },
      { status: 500 }
    );
  }

  const url = createAuthUrl(request.nextUrl.origin);
  return NextResponse.redirect(url);
}
