import { NextResponse } from "next/server";
import { seedDemoAgentIfEmpty, snapshotState } from "@/lib/control-plane";

export function GET() {
  seedDemoAgentIfEmpty();
  return NextResponse.json(snapshotState());
}