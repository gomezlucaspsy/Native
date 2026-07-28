"use client";

import { useEffect, useRef, useState } from "react";

type Agent = {
  agentId: string;
  label: string;
  platform: string;
  version: string;
  lastSeenAt: string;
  status: "online" | "offline";
};
type Message = { role: "user" | "assistant"; text: string };
type Tab = "computer" | "share" | "chat";
type ShareFile = { id: string; name: string; size: number; url: string; qr: string; createdAt: string };

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
  const WELCOME = "Hey — ask me about your computer or shared files. I can also browse and read files from My Computer to answer questions grounded in your own documents.";
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
    { id: "computer", label: "MY COMPUTER" },
    { id: "share",    label: `SHARE${shares.length ? ` (${shares.length})` : ""}` },
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
      </nav>

      {/* ── MY COMPUTER ── */}
      {tab === "computer" && (
        <section className="pane center-pane">
          <div className="hs-card">
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
