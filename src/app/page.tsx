"use client";

import { useEffect, useRef, useState } from "react";

type Device = { id: string; name: string; ip: string; mac: string; connectedAt: string };
type HotspotStatus = "on" | "off" | "loading";
type Message = { role: "user" | "assistant"; text: string };
type Tab = "hotspot" | "devices" | "share" | "chat";
type ShareFile = { id: string; name: string; size: number; url: string; qr: string; createdAt: string };

export default function Home() {
  const [tab, setTab] = useState<Tab>("hotspot");

  // ── Hotspot ──────────────────────────────────────────────
  const [hotspot, setHotspot] = useState<HotspotStatus>("off");
  const [hotspotResult, setHotspotResult] = useState("");

  async function toggleHotspot() {
    const cmdType = hotspot === "on" ? "stop_hotspot" : "start_hotspot";
    setHotspot("loading");
    setHotspotResult("");
    try {
      const res = await fetch("/api/agent/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "host-main", type: cmdType, payload: {} }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHotspot(cmdType === "start_hotspot" ? "on" : "off");
      setHotspotResult(cmdType === "start_hotspot" ? "Hotspot starting..." : "Hotspot stopping...");
      // Poll for the command result so we can show real netsh output
      pollCommandResult(cmdType === "start_hotspot" ? "on" : "off");
    } catch (e) {
      setHotspotResult(`Error: ${e}`);
      setHotspot("off");
    }
  }

  function pollCommandResult(expectedState: "on" | "off") {
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch("/api/control/state");
        if (!res.ok) return;
        const data = await res.json() as { commands: { type: string; status: string; result?: string }[] };
        const cmd = data.commands.find(
          (c) => c.type === (expectedState === "on" ? "start_hotspot" : "stop_hotspot") &&
                 (c.status === "completed" || c.status === "failed")
        );
        if (cmd || attempts > 10) {
          clearInterval(timer);
          if (cmd?.result) setHotspotResult(cmd.result);
        }
      } catch { clearInterval(timer); }
    }, 2000);
  }

  // ── Devices ───────────────────────────────────────────────
  const [devices, setDevices] = useState<Device[]>([]);
  const [devError, setDevError] = useState("");

  async function loadDevices() {
    try {
      const res = await fetch("/api/devices");
      if (!res.ok) { setDevError(`Error ${res.status}`); return; }
      const data = await res.json();
      // handle both array and {value:[]} shapes
      setDevices(Array.isArray(data) ? data : data.value ?? []);
    } catch (e) {
      setDevError(`Failed to load: ${e}`);
    }
  }

  async function deleteDevice(id: string) {
    await fetch(`/api/devices/${id}`, { method: "DELETE" });
    setDevices((d) => d.filter((x) => x.id !== id));
  }

  useEffect(() => {
    loadDevices();
    const t = setInterval(loadDevices, 5000);
    return () => clearInterval(t);
  }, []);

  // ── QuickShare ────────────────────────────────────────────
  const [shares, setShares] = useState<ShareFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/share", { method: "POST", body: form });
      if (!res.ok) { setUploadError(`Upload failed: HTTP ${res.status}`); return; }
      const item = await res.json() as ShareFile;
      setShares((s) => [item, ...s]);
    } catch (e) {
      setUploadError(`Upload error: ${e}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function loadShares() {
    const res = await fetch("/api/share");
    if (res.ok) {
      const data = await res.json();
      setShares(Array.isArray(data) ? data : []);
    }
  }

  async function deleteShare(id: string) {
    await fetch(`/api/share/${id}`, { method: "DELETE" });
    setShares((s) => s.filter((x) => x.id !== id));
  }

  useEffect(() => { loadShares(); }, []);

  // ── Claude chat ───────────────────────────────────────────
  // NOTE: Anthropic requires conversation starts with role "user"
  // We store the welcome as a local display-only message, not sent to the API
  const WELCOME = "Hey — ask me anything about your hotspot, devices, or shared files.";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [chatError, setChatError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    setChatError("");
    const next: Message[] = [...messages, { role: "user", text }];
    setMessages(next);
    setThinking(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      const data = await res.json() as { reply: string };
      setMessages([...next, { role: "assistant", text: data.reply }]);
    } catch (e) {
      setChatError(`Claude error: ${e}`);
    } finally {
      setThinking(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "hotspot", label: "HOTSPOT" },
    { id: "devices", label: `DEVICES${devices.length ? ` (${devices.length})` : ""}` },
    { id: "share",   label: `SHARE${shares.length ? ` (${shares.length})` : ""}` },
    { id: "chat",    label: "CLAUDE" },
  ];

  return (
    <main className="shell">
      <div className="grid-overlay" />

      <header className="topbar">
        <span className="logo">NATIVE<span className="logo-accent">//</span>SHARE</span>
        <span className={`hs-pill ${hotspot}`}>
          <span className="pill-dot" />
          {hotspot === "loading" ? "SWITCHING..." : `HOTSPOT ${hotspot.toUpperCase()}`}
        </span>
      </header>

      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── HOTSPOT ── */}
      {tab === "hotspot" && (
        <section className="pane center-pane">
          <div className="hs-card">
            <div className={`hs-ring ${hotspot}`} />
            <span className="hs-state">
              {hotspot === "loading" ? "SWITCHING..." : hotspot === "on" ? "ONLINE" : "OFFLINE"}
            </span>
            <p className="hs-sub">WiFi Hotspot · SSID: NativeShare</p>
            <button
              className={`hs-btn ${hotspot === "on" ? "danger" : "primary"}`}
              onClick={toggleHotspot}
              disabled={hotspot === "loading"}
            >
              {hotspot === "loading" ? "WORKING..." : hotspot === "on" ? "STOP HOTSPOT" : "START HOTSPOT"}
            </button>
            {hotspotResult && (
              <pre className="hs-result">{hotspotResult}</pre>
            )}
          </div>
        </section>
      )}

      {/* ── DEVICES ── */}
      {tab === "devices" && (
        <section className="pane">
          <div className="pane-header">
            <h2 className="pane-title">CONNECTED DEVICES</h2>
            <button className="refresh-btn" onClick={loadDevices}>↺ REFRESH</button>
          </div>
          {devError && <p className="err-text">{devError}</p>}
          {devices.length === 0 && !devError && <p className="empty">No devices connected.</p>}
          <div className="list">
            {devices.map((d) => (
              <div key={d.id} className="list-row">
                <div className="list-icon">📱</div>
                <div className="list-body">
                  <strong>{d.name}</strong>
                  <small>{d.ip} · {d.mac}</small>
                  <small>{new Date(d.connectedAt).toLocaleTimeString()}</small>
                </div>
                <button className="del-btn" onClick={() => deleteDevice(d.id)} title="Kick device">✕</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── QUICKSHARE ── */}
      {tab === "share" && (
        <section className="pane">
          <h2 className="pane-title">QUICKSHARE</h2>
          <p className="pane-sub">Drop or pick a file → instant QR link for anyone on the hotspot.</p>

          <div
            className={`drop-zone ${dragOver ? "drag-active" : ""} ${uploading ? "uploading" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) uploadFile(f);
            }}
          >
            <span className="drop-icon">⬆</span>
            <span>{uploading ? "UPLOADING..." : dragOver ? "DROP IT!" : "DROP FILE HERE"}</span>
            <button
              className="browse-btn"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              type="button"
            >
              BROWSE
            </button>
            <input
              ref={fileRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
              }}
            />
          </div>

          {uploadError && <p className="err-text">{uploadError}</p>}

          <div className="list">
            {shares.length === 0 && <p className="empty">No shared files yet.</p>}
            {shares.map((s) => (
              <div key={s.id} className="list-row share-row">
                <div className="list-body">
                  <strong>{s.name}</strong>
                  <small>{(s.size / 1024).toFixed(1)} KB · {new Date(s.createdAt).toLocaleTimeString()}</small>
                  <a className="share-link" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                </div>
                {s.qr && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.qr} alt="QR code" width={80} height={80} className="qr-img" />
                )}
                <button className="del-btn" onClick={() => deleteShare(s.id)}>✕</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── CLAUDE ── */}
      {tab === "chat" && (
        <section className="pane chat-pane">
          <h2 className="pane-title">CLAUDE AI</h2>
          <div className="chat-log">
            {/* welcome message — display only, not sent to API */}
            <div className="bubble assistant">
              <span className="role">claude</span>
              <p>{WELCOME}</p>
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                <span className="role">{m.role === "user" ? "you" : "claude"}</span>
                <p>{m.text}</p>
              </div>
            ))}
            {thinking && (
              <div className="bubble assistant">
                <span className="role">claude</span>
                <p className="thinking">▋</p>
              </div>
            )}
            {chatError && <p className="err-text">{chatError}</p>}
            <div ref={bottomRef} />
          </div>
          <form className="chat-form" onSubmit={(e) => { e.preventDefault(); sendMessage(); }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Claude..."
              disabled={thinking}
            />
            <button type="submit" disabled={thinking || !input.trim()}>↑</button>
          </form>
        </section>
      )}
    </main>
  );
}
