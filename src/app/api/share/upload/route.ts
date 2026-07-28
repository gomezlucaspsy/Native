import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import QRCode from "qrcode";
import type { ShareItem } from "../route";

// Client-side uploads talk to Vercel Blob directly from the browser — the
// file's bytes never pass through this (or any) Vercel Function, so they
// aren't subject to the platform's request body size limit. This route only
// issues a short-lived upload token and, once Blob confirms the upload,
// records the resulting file in the same in-memory share list the rest of
// the app reads from.
//
// Without this, every /api/share POST carried the raw file through a
// Function and got hard-capped — large files (a real .docx/.pptx/video)
// came back as a 413 no matter what else changed in the deployment.

declare global {
  var nativeShares: ShareItem[] | undefined;
}

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB — generous for docs/media, bounded to avoid abuse

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        return {
          allowedContentTypes: ["*/*"],
          addRandomSuffix: false,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          tokenPayload: clientPayload,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (!tokenPayload) return;
        const { id, name, size } = JSON.parse(tokenPayload) as {
          id: string;
          name: string;
          size: number;
        };

        const qr = await QRCode.toDataURL(blob.url, {
          width: 512,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#39ff14", light: "#0a0a0a" },
        });

        const shares: ShareItem[] = globalThis.nativeShares ?? (globalThis.nativeShares = []);
        if (shares.some((s) => s.id === id)) return; // already registered (e.g. duplicate webhook delivery)

        shares.unshift({
          id,
          name,
          size,
          url: blob.url,
          qr,
          createdAt: new Date().toISOString(),
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
