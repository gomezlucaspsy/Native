"use client";

import { useEffect, useRef, useState } from "react";
import FileExplorer from "@/components/FileExplorer";
import { fsApplyAction, fsLoad, fsSave, fsTree, type FsAction } from "@/lib/virtual-fs";

const GITHUB_URL = "https://github.com/gomezlucaspsy/Native";

type Agent = {
  agentId: string;
  label: string;
  platform: string;
  version: string;
  lastSeenAt: string;
  status: "online" | "offline";
};
type Device = {
  deviceId: string;
  label: string;
  kind: string;
  lastSeenAt: string;
  status: "online" | "offline";
};
type GoogleStatus = { configured: boolean; connected: boolean; email?: string };
type Message = { role: "user" | "assistant"; text: string };
type Tab = "computer" | "share" | "chat" | "connect";
type ShareFile = { id: string; name: string; size: number; url: string; qr: string; createdAt: string; driveUrl?: string };

const DEVICE_ID_KEY = "native-device-id";

// Claude replies can end with a fenced ```file-action {...}``` block to create,
// update, or delete an entry in the sandboxed "computer" filesystem. Parse it
// out, apply it, and strip it from the text shown in the chat bubble.
function extractFileAction(text: string): { clean: string; action: FsAction | null } {
  const match = text.match(/```file-action\s*\n([\s\S]*?)```/);
  if (!match) return { clean: text, action: null };
  try {
    const action = JSON.parse(match[1].trim()) as FsAction;
    return { clean: text.slice(0, match.index).trim(), action };
  } catch {
    return { clean: text, action: null };
  }
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("computer");

  // ── My Computer ──────────────────────────────────────────
  const [computer, setComputer] = useState<Agent | null>(null);
  const [computerError, setComputerError] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);

  async function loadComputer() {
    try {
      const res = await fetch("/api/control/state");
      if (!res.ok) { setComputerError(`Error ${res.status}`); return; }
      const data = await res.json() as { agents: Agent[] };
      const agent = data.agents[0] ?? null;
      setComputer(agent);
      setComputerError("");
      if (agent) setLabelInput((prev) => (prev ? prev : agent.label));
    } catch (e) {
      setComputerError(`Failed to load: ${e}`);
    }
  }

  async function renameComputer() {
    if (!computer || !labelInput.trim()) return;
    setSavingLabel(true);
    try {
      const res = await fetch(`/api/computer/${computer.agentId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: labelInput.trim() }),
      });
      if (res.ok) setComputer(await res.json());
    } finally {
      setSavingLabel(false);
    }
  }

  async function forgetComputer() {
    if (!computer) return;
    await fetch(`/api/computer/${computer.agentId}`, { method: "DELETE" });
    setComputer(null);
    setLabelInput("");
  }

  useEffect(() => {
    loadComputer();
    const t = setInterval(loadComputer, 5000);
    return () => clearInterval(t);
  }, []);

  // ── Connect Devices ──────────────────────────────────────
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesError, setDevicesError] = useState("");
  const [pairUrl, setPairUrl] = useState("");
  const [pairQr, setPairQr] = useState("");
  const [renamingDevice, setRenamingDevice] = useState<string | null>(null);
  const [deviceLabelInput, setDeviceLabelInput] = useState("");

  async function loadDevices() {
    try {
      const res = await fetch("/api/control/state");
      if (!res.ok) { setDevicesError(`Error ${res.status}`); return; }
      const data = await res.json() as { devices: Device[] };
      setDevices(data.devices ?? []);
      setDevicesError("");
    } catch (e) {
      setDevicesError(`Failed to load: ${e}`);
    }
  }

  async function loadPairQr() {
    const res = await fetch("/api/device/pair-qr");
    if (res.ok) {
      const data = await res.json() as { url: string; qr: string };
      setPairUrl(data.url);
      setPairQr(data.qr);
    }
  }

  async function saveDeviceLabel(deviceId: string) {
    if (!deviceLabelInput.trim()) return;
    const res = await fetch(`/api/device/${deviceId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: deviceLabelInput.trim() }),
    });
    if (res.ok) {
      const updated = await res.json() as Device;
      setDevices((list) => list.map((d) => (d.deviceId === deviceId ? updated : d)));
    }
    setRenamingDevice(null);
  }

  async function forgetDevice(deviceId: string) {
    await fetch(`/api/device/${deviceId}`, { method: "DELETE" });
    setDevices((list) => list.filter((d) => d.deviceId !== deviceId));
    if (localStorage.getItem(DEVICE_ID_KEY) === deviceId) {
      localStorage.removeItem(DEVICE_ID_KEY);
    }
  }

  useEffect(() => {
    loadDevices();
    loadPairQr();
    const t = setInterval(loadDevices, 5000);
    return () => clearInterval(t);
  }, []);

  // if this browser was previously paired (via /pair), keep it heartbeating
  // so it shows up online in the devices list while this tab is open
  useEffect(() => {
    const deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) return;

    const beat = () => fetch("/api/device/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    }).catch(() => {});

    beat();
    const t = setInterval(beat, 15000);
    return () => clearInterval(t);
  }, []);

  // ── Google account ───────────────────────────────────────
  const [google, setGoogle] = useState<GoogleStatus>({ configured: false, connected: false });
  const [googleMsg, setGoogleMsg] = useState("");

  async function loadGoogleStatus() {
    const res = await fetch("/api/google/status");
    if (res.ok) setGoogle(await res.json());
  }

  async function disconnectGoogle() {
    await fetch("/api/google/disconnect", { method: "POST" });
    loadGoogleStatus();
  }

  useEffect(() => {
    loadGoogleStatus();
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google");
    if (result === "connected") setGoogleMsg("Google account connected.");
    if (result === "error") setGoogleMsg("Google connection failed — check GOOGLE_CLIENT_ID/SECRET and try again.");
    if (result) {
      setTab("connect");
      params.delete("google");
      const q = params.toString();
      window.history.replaceState({}, "", q ? `/?${q}` : "/");
    }
  }, []);

  // ── QuickShare ────────────────────────────────────────────
  const [shares, setShares] = useState<ShareFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [sendToDrive, setSendToDrive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      if (sendToDrive && google.connected) form.append("toDrive", "1");
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
  const WELCOME = "Hey — ask me anything about your computer or shared files.";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [chatError, setChatError] = useState("");
  const [filesVersion, setFilesVersion] = useState(0);
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
        body: JSON.stringify({ messages: next, filesTree: fsTree(fsLoad()) }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      const data = await res.json() as { reply: string };
      const { clean, action } = extractFileAction(data.reply);
      let reply = clean;
      if (action) {
        fsSave(fsApplyAction(fsLoad(), action));
        setFilesVersion((v) => v + 1);
        const target = action.name ? (action.path === "/" ? `/${action.name}` : `${action.path}/${action.name}`) : action.path;
        reply = `${reply}\n\n✓ ${action.action}d ${target}`.trim();
      }
      setMessages([...next, { role: "assistant", text: reply }]);
    } catch (e) {
      setChatError(`Claude error: ${e}`);
    } finally {
      setThinking(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "computer", label: "MY COMPUTER" },
    { id: "share",    label: `SHARE${shares.length ? ` (${shares.length})` : ""}` },
    { id: "connect",  label: `CONNECT${devices.length ? ` (${devices.length})` : ""}` },
    { id: "chat",     label: "CLAUDE" },
  ];

  return (
    <main className="shell">
      <div className="grid-overlay" />

      <header className="topbar">
        <span className="logo">NATIVE<span className="logo-accent">//</span>SHARE</span>
        <span className={`hs-pill ${computer?.status === "online" ? "on" : "off"}`}>
          <span className="pill-dot" />
          {computer ? `${computer.status.toUpperCase()}` : "NO AGENT"}
        </span>
      </header>

      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <a className="tab" href={GITHUB_URL} target="_blank" rel="noreferrer">GITHUB ↗</a>
      </nav>

      {/* ── MY COMPUTER ── */}
      {tab === "computer" && (
        <section className="pane pane-wide">
          <div className="hs-card compact">
            {computerError && <p className="err-text">{computerError}</p>}
            {!computer && !computerError && (
              <p className="empty">No computer registered yet. Start the host agent.</p>
            )}
            {computer && (
              <>
                <span className={`hs-pill ${computer.status === "online" ? "on" : "off"}`}>
                  <span className="pill-dot" />
                  {computer.status.toUpperCase()}
                </span>
                <div className="list-row" style={{ width: "100%", marginTop: "1rem" }}>
                  <input
                    className="rename-input"
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    placeholder="Computer name"
                  />
                  <button className="hs-btn primary" onClick={renameComputer} disabled={savingLabel || !labelInput.trim()}>
                    {savingLabel ? "SAVING..." : "SAVE"}
                  </button>
                </div>
                <p className="hs-sub">{computer.platform} · v{computer.version}</p>
                <p className="hs-sub">Last seen {new Date(computer.lastSeenAt).toLocaleTimeString()}</p>
                <button className="hs-btn danger" onClick={forgetComputer}>FORGET THIS COMPUTER</button>
              </>
            )}
          </div>

          <div className="section-head">
            <h2 className="pane-title">VIRTUAL FILES</h2>
            <p className="pane-sub">
              A sandboxed file system stored in this browser — create, edit, and delete files/folders,
              and Claude (in the CLAUDE tab) can read and write to it too.
            </p>
          </div>
          <FileExplorer refreshKey={filesVersion} />
        </section>
      )}

      {/* ── QUICKSHARE ── */}
      {tab === "share" && (
        <section className="pane">
          <h2 className="pane-title">QUICKSHARE</h2>
          <p className="pane-sub">Drop or pick a file → instant QR link to grab it from any device.</p>

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

          {google.connected && (
            <label className="drive-toggle">
              <input type="checkbox" checked={sendToDrive} onChange={(e) => setSendToDrive(e.target.checked)} />
              Also send to Google Drive ({google.email})
            </label>
          )}

          <div className="list">
            {shares.length === 0 && <p className="empty">No shared files yet.</p>}
            {shares.map((s) => (
              <div key={s.id} className="share-card">
                <div className="share-card-head">
                  <strong>{s.name}</strong>
                  <button className="del-btn" onClick={() => deleteShare(s.id)}>✕</button>
                </div>
                {s.qr && (
                  <div className="qr-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.qr} alt="QR code" className="qr-img" />
                  </div>
                )}
                <div className="share-meta">
                  <small>{(s.size / 1024).toFixed(1)} KB · {new Date(s.createdAt).toLocaleTimeString()}</small>
                  <a className="share-link" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                  {s.driveUrl && (
                    <a className="share-link" href={s.driveUrl} target="_blank" rel="noreferrer">Drive: {s.driveUrl}</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── CONNECT ── */}
      {tab === "connect" && (
        <section className="pane">
          <h2 className="pane-title">CONNECT DEVICES</h2>
          <p className="pane-sub">Scan this on a phone to pair it — it will show up below and can send/grab files here anytime.</p>

          {pairQr && (
            <div className="qr-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pairQr} alt="Pairing QR code" className="qr-img" />
            </div>
          )}
          {pairUrl && <p className="hs-sub" style={{ textAlign: "center" }}>{pairUrl}</p>}

          {devicesError && <p className="err-text">{devicesError}</p>}

          <div className="list">
            {devices.length === 0 && <p className="empty">No devices paired yet.</p>}
            {devices.map((d) => (
              <div key={d.deviceId} className="list-row">
                <span className={`hs-pill ${d.status === "online" ? "on" : "off"}`}>
                  <span className="pill-dot" />
                </span>
                <div className="list-body">
                  {renamingDevice === d.deviceId ? (
                    <input
                      className="rename-input"
                      autoFocus
                      value={deviceLabelInput}
                      onChange={(e) => setDeviceLabelInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveDeviceLabel(d.deviceId); if (e.key === "Escape") setRenamingDevice(null); }}
                      onBlur={() => saveDeviceLabel(d.deviceId)}
                    />
                  ) : (
                    <>
                      <strong
                        onClick={() => { setRenamingDevice(d.deviceId); setDeviceLabelInput(d.label); }}
                        style={{ cursor: "pointer" }}
                      >
                        {d.label}
                      </strong>
                      <small>{d.kind} · last seen {new Date(d.lastSeenAt).toLocaleTimeString()}</small>
                    </>
                  )}
                </div>
                <button className="del-btn" onClick={() => forgetDevice(d.deviceId)}>FORGET</button>
              </div>
            ))}
          </div>

          <h2 className="pane-title" style={{ marginTop: "0.5rem" }}>ACCOUNTS</h2>
          {googleMsg && <p className="hs-sub">{googleMsg}</p>}
          <div className="list-row">
            <div className="list-body">
              <strong>Google Drive</strong>
              <small>{google.connected ? `Connected as ${google.email}` : google.configured ? "Not connected" : "Not configured on this deployment"}</small>
            </div>
            {google.connected ? (
              <button className="del-btn" onClick={disconnectGoogle}>DISCONNECT</button>
            ) : (
              <a
                className={`hs-btn primary ${!google.configured ? "disabled-link" : ""}`}
                style={{ width: "auto", textDecoration: "none", padding: "0.5rem 1rem" }}
                href={google.configured ? "/api/google/auth" : undefined}
                aria-disabled={!google.configured}
              >
                CONNECT
              </a>
            )}
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
