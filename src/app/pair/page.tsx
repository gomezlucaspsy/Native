"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const DEVICE_ID_KEY = "native-device-id";

function detectDevice(ua: string): { kind: string; label: string } {
  if (/iPhone/i.test(ua)) return { kind: "ios", label: "iPhone" };
  if (/iPad/i.test(ua)) return { kind: "ios", label: "iPad" };
  if (/Android/i.test(ua)) return { kind: "android", label: "Android Phone" };
  if (/Macintosh/i.test(ua)) return { kind: "mac", label: "Mac" };
  if (/Windows/i.test(ua)) return { kind: "windows", label: "Windows PC" };
  return { kind: "unknown", label: "Device" };
}

export default function PairPage() {
  const [status, setStatus] = useState<"pairing" | "done" | "error">("pairing");

  useEffect(() => {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }

    const { kind, label } = detectDevice(navigator.userAgent);

    fetch("/api/device/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, label, kind, userAgent: navigator.userAgent }),
    })
      .then((res) => setStatus(res.ok ? "done" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <main className="shell">
      <div className="grid-overlay" />
      <section className="pane center-pane">
        <div className="hs-card">
          {status === "pairing" && <p className="hs-sub">Pairing this device...</p>}
          {status === "done" && (
            <>
              <span className="hs-pill on">
                <span className="pill-dot" />
                CONNECTED
              </span>
              <p className="hs-sub" style={{ marginTop: "1rem" }}>
                This device is now paired. Open Native Share here any time to send or grab files.
              </p>
              <Link href="/" className="hs-btn primary" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
                OPEN NATIVE SHARE
              </Link>
            </>
          )}
          {status === "error" && <p className="err-text">Pairing failed. Check the connection and reload.</p>}
        </div>
      </section>
    </main>
  );
}
