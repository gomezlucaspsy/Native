import { NextRequest, NextResponse } from "next/server";

declare global {
  var nativeShares: { id: string; name: string; size: number; url: string; qr: string; createdAt: string }[] | undefined;
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const shares = globalThis.nativeShares ?? [];
  const idx = shares.findIndex((s) => s.id === id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });

  const item = shares[idx];
  shares.splice(idx, 1);

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { del } = await import("@vercel/blob");
    await del(item.url).catch(() => {});
  } else {
    const { unlink } = await import("fs/promises");
    const path = await import("path");
    const filename = item.url.split("/").pop()!;
    await unlink(path.join(process.cwd(), "public", "shares", filename)).catch(() => {});
  }

  return NextResponse.json({ deleted: id });
}
