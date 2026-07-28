import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getShareableOrigin } from "@/lib/network";

export async function GET(request: NextRequest) {
  const url = `${getShareableOrigin(request)}/pair`;
  const qr = await QRCode.toDataURL(url, {
    width: 512,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#39ff14", light: "#0a0a0a" },
  });

  return NextResponse.json({ url, qr });
}
