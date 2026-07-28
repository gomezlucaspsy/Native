import { NextRequest, NextResponse } from "next/server";
import { consumeState, exchangeCode } from "@/lib/google-auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const home = new URL("/", request.nextUrl.origin);

  if (!code || !state || !consumeState(state)) {
    home.searchParams.set("google", "error");
    return NextResponse.redirect(home);
  }

  try {
    await exchangeCode(code, request.nextUrl.origin);
    home.searchParams.set("google", "connected");
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    home.searchParams.set("google", "error");
  }

  return NextResponse.redirect(home);
}
