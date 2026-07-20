"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

type Device = { id: string; name: string; ip: string; mac: string; connectedAt: string };
type HotspotStatus = "on" | "off" | "loading";
type Message = { role: "user" | "assistant"; text: string };
type Tab = "hotspot" | "devices" | "share" | "chat";
type ShareFile = { id: string; name: string; size: number; url: string; qr: string; createdAt: string };

export default function Home() {
  const [tab, setTab] = useState<Tab>("hotspot");

  // ── Hotspot ──────────────────────────────────────────────
  const [hotspot, setHotspot] = useState<HotspotStatus>("off");

  async function toggleHotspot() {
    const next = hotspot === "on" ? "stop_hotspot" : "start_hotspot";
    setHotspot("loading");
    await fetch("/api/agent/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "host-main", type: next, payload: {} }),
    });
    setHotspot(next === "start_hotspot" ? "on" : "off");
  }

  // ── Devices ───────────────────────────────────────────────
  const [devices, setDevices] = useState<Device[]>([]);

  async function loadDevices() {
    const res = await fetch("/api/devices");
    if (res.ok) setDevices(await res.json());
  }

  async function deleteDevice(id: string) {
    await fetch(`/api/devices/${id}`, { method: "DELETE" });
    loadDevices();
  }

  useEffect(() => {
    loadDevices();
    const t = setInterval(loadDevices, 5000);
    return () => clearInterval(t);
  }, []);

  // ── QuickShare ────────────────────────────────────────────
  const [shares, setShares] = useState<ShareFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/share", { method: "POST", body: form });
    if (res.ok) {
      const item = await res.json();
      setShares((s) => [item, ...s]);
    }
    setUploading(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) uploadFile(f);
  }

  async function loadShares() {
    const res = await fetch("/api/share");
    if (res.ok) setShares(await res.json());
  }

  async function deleteShare(id: string) {
    await fetch(`/api/share/${id}`, { method: "DELETE" });
    setShares((s) => s.filter((x) => x.id !== id));
  }

  useEffect(() => { loadShares(); }, []);

  // ── Claude chat ───────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hey — ask me anything about your hotspot, devices, or files." },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    const next: Message[] = [...messages, { role: "user", text }];
    setMessages(next);
    setThinking(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", text: data.reply }]);
    } catch {
      setMessages([...next, { role: "assistant", text: "Error reaching Claude." }]);
    } finally {
      setThinking(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "hotspot", label: "HOTSPOT" },
    { id: "devices", label: `DEVICES${devices.length ? ` (${devices.length})` : ""}` },
    { id: "share",   label: "QUICKSHARE" },
    { id: "chat",    label: "CLAUDE" },
  ];

  return (
    <main className="shell">
      <div className="grid-overlay" />

      <header className="topbar">
        <span className="logo">NATIVE<span className="logo-accent">//</span>SHARE</span>
        <span className={`hs-pill ${hotspot}`}>
          <span className="pill-dot" />
          {hotspot === "loading" ? "..." : `HOTSPOT ${hotspot.toUpperCase()}`}
        </span>
      </header>

      {/* Tab bar */}
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
            <span className="hs-state">{hotspot === "loading" ? "SWITCHING..." : hotspot === "on" ? "ONLINE" : "OFFLINE"}</span>
            <p className="hs-sub">WiFi Hotspot · SSID: NativeShare</p>
            <button
              className={`hs-btn ${hotspot === "on" ? "danger" : "primary"}`}
              onClick={toggleHotspot}
              disabled={hotspot === "loading"}
            >
              {hotspot === "on" ? "STOP HOTSPOT" : "START HOTSPOT"}
            </button>
          </div>
        </section>
      )}

      {/* ── DEVICES ── */}
      {tab === "devices" && (
        <section className="pane">
          <h2 className="pane-title">CONNECTED DEVICES</h2>
          {devices.length === 0 && <p className="empty">No devices connected.</p>}
          <div className="list">
            {devices.map((d) => (
              <div key={d.id} className="list-row">
                <div className="list-icon">📱</div>
                <div className="list-body">
                  <strong>{d.name}</strong>
                  <small>{d.ip} · {d.mac}</small>
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
          <p className="pane-sub">Drop a file → get a QR link. Anyone on the hotspot can scan it.</p>

          <div
            className={`drop-zone ${dragOver ? "drag-active" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <span>UPLOADING...</span> : <span>DROP FILE HERE  ·  OR CLICK TO BROWSE</span>}
            <input ref={fileRef} type="file" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
          </div>

          <div className="list">
            {shares.map((s) => (
              <div key={s.id} className="list-row share-row">
                <div className="list-body">
                  <strong>{s.name}</strong>
                  <small>{(s.size / 1024).toFixed(1)} KB · {new Date(s.createdAt).toLocaleTimeString()}</small>
                  <a className="share-link" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                </div>
                {s.qr && (
                  <Image src={s.qr} alt="QR" width={80} height={80} className="qr-img" unoptimized />
                )}
                <button className="del-btn" onClick={() => deleteShare(s.id)}>✕</button>
              </div>
            ))}
            {shares.length === 0 && <p className="empty">No shared files yet.</p>}
          </div>
        </section>
      )}

      {/* ── CLAUDE ── */}
      {tab === "chat" && (
        <section className="pane chat-pane">
          <h2 className="pane-title">CLAUDE AI</h2>
          <div className="chat-log">
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
            <div ref={bottomRef} />
          </div>
          <form className="chat-form" onSubmit={(e) => { e.preventDefault(); sendMessage(); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Claude..." />
            <button type="submit" disabled={thinking}>↑</button>
          </form>
        </section>
      )}
    </main>
  );
}
