import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { put } from "@vercel/blob";
import { getLanIP } from "@/lib/network";
import { getConnection, uploadFileToDrive } from "@/lib/google-auth";

export interface ShareItem {
  id: string;
  name: string;
  size: number;
  url: string;
  qr: string;
  createdAt: string;
  driveUrl?: string;
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
  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });

    const id = `share-${Date.now()}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${id}-${safeName}`;

    let fileUrl: string;

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

    if (blobToken) {
      // ── Vercel Blob ───────────────────────────────────────
      const blob = await put(filename, file, {
        access: "public",
        token: blobToken,
      });
      fileUrl = blob.url;
    } else if (process.env.VERCEL) {
      // Deployed on Vercel but no Blob token wired up — the local filesystem
      // fallback below would hit a read-only /var/task and 500 with a confusing
      // ENOENT. Fail clearly instead so the real cause (missing/stale
      // BLOB_READ_WRITE_TOKEN — needs a redeploy after being linked) is obvious.
      return NextResponse.json(
        { error: "File storage is not configured for this deployment (missing BLOB_READ_WRITE_TOKEN)." },
        { status: 500 }
      );
    } else {
      // ── Local filesystem ──────────────────────────────────
      const { writeFile, mkdir } = await import("fs/promises");
      const { existsSync } = await import("fs");
      const path = await import("path");
      const uploadDir = path.join(process.cwd(), "public", "shares");
      if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true });
      await writeFile(
        path.join(uploadDir, filename),
        Buffer.from(await file.arrayBuffer())
      );
      const port = process.env.PORT ?? "3000";
      fileUrl = `http://${getLanIP()}:${port}/shares/${filename}`;
    }

    const qr = await QRCode.toDataURL(fileUrl, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#39ff14", light: "#0a0a0a" },
    });

    let driveUrl: string | undefined;
    const wantsDrive = form.get("toDrive") === "1";
    if (wantsDrive && getConnection().connected) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const uploaded = await uploadFileToDrive(buffer, file.name, file.type || "application/octet-stream");
        driveUrl = uploaded.webViewLink;
      } catch (err) {
        console.error("Drive upload error:", err);
      }
    }

    const item: ShareItem = {
      id,
      name: file.name,
      size: file.size,
      url: fileUrl,
      qr,
      createdAt: new Date().toISOString(),
      driveUrl,
    };

    shares.unshift(item);
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    console.error("Share upload error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
