import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

export interface ShareItem {
  id: string;
  name: string;
  size: number;
  url: string;
  qr: string;
  createdAt: string;
}

declare global {
  var nativeShares: ShareItem[] | undefined;
}

const shares: ShareItem[] =
  globalThis.nativeShares ?? (globalThis.nativeShares = []);

export async function GET() {
  return NextResponse.json(shares);
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });

  const id = `share-${Date.now()}`;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${id}-${safeName}`;

  let fileUrl: string;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // ── Vercel: use Blob storage ──────────────────────────
    const { put } = await import("@vercel/blob");
    const blob = await put(filename, file, { access: "public" });
    fileUrl = blob.url;
  } else {
    // ── Local: write to /public/shares/ ──────────────────
    const { writeFile, mkdir } = await import("fs/promises");
    const { existsSync } = await import("fs");
    const path = await import("path");
    const uploadDir = path.join(process.cwd(), "public", "shares");
    if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true });
    await writeFile(
      path.join(uploadDir, filename),
      Buffer.from(await file.arrayBuffer())
    );
    const host = request.headers.get("host") ?? "localhost:3000";
    const proto = host.startsWith("localhost") ? "http" : "https";
    fileUrl = `${proto}://${host}/shares/${filename}`;
  }

  const qr = await QRCode.toDataURL(fileUrl, {
    width: 160,
    color: { dark: "#39ff14", light: "#0a0a0a" },
  });

  const item: ShareItem = {
    id,
    name: file.name,
    size: file.size,
    url: fileUrl,
    qr,
    createdAt: new Date().toISOString(),
  };

  shares.unshift(item);
  return NextResponse.json(item, { status: 201 });
}
