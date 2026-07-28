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
type Message = { role: "user" | "assistant"; text: string };
type Tab = "computer" | "share" | "chat";
type ShareFile = { id: string; name: string; size: number; url: string; qr: string; createdAt: string };

const DOC_ACCEPT =
  ".pdf,.doc,.docx,.txt,.rtf,.md,.csv,.xls,.xlsx,.ppt,.pptx,.zip,.json,application/pdf,text/plain";

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
  const [editingName, setEditingName] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const forgetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  async function commitRename() {
    const value = labelInput.trim();
    if (!computer || !value || value === computer.label) { setEditingName(false); return; }
    setSavingLabel(true);
    try {
      const res = await fetch(`/api/computer/${computer.agentId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: value }),
      });
      if (res.ok) setComputer(await res.json());
    } finally {
      setSavingLabel(false);
      setEditingName(false);
    }
  }

  function handleForgetClick() {
    if (!confirmForget) {
      setConfirmForget(true);
      forgetTimer.current = setTimeout(() => setConfirmForget(false), 3000);
      return;
    }
    if (forgetTimer.current) clearTimeout(forgetTimer.current);
    setConfirmForget(false);
    forgetComputer();
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

  useEffect(() => () => { if (forgetTimer.current) clearTimeout(forgetTimer.current); }, []);

  // ── QuickShare ────────────────────────────────────────────
  const [shares, setShares] = useState<ShareFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [blobEnabled, setBlobEnabled] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const anyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((res) => res.json())
      .then((data: { architecture?: { fileStorage?: string } }) => {
        setBlobEnabled(data.architecture?.fileStorage === "vercel-blob");
      })
      .catch(() => {});
  }, []);

  // Files go straight from the browser to Vercel Blob (bypassing this app's
  // Functions entirely) whenever Blob storage is configured, so upload size
  // isn't capped by a Function's request body limit. Falls back to the old
  // server-upload path for local dev without a Blob token.
  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError("");
    try {
      if (blobEnabled) {
        const { upload } = await import("@vercel/blob/client");
        const QRCode = (await import("qrcode")).default;

        const id = `share-${Date.now()}`;
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const blob = await upload(`${id}-${safeName}`, file, {
          access: "public",
          handleUploadUrl: "/api/share/upload",
          clientPayload: JSON.stringify({ id, name: file.name, size: file.size }),
        });

        const qr = await QRCode.toDataURL(blob.url, {
          width: 512,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#39ff14", light: "#0a0a0a" },
        });

        const item: ShareFile = {
          id,
          name: file.name,
          size: file.size,
          url: blob.url,
          qr,
          createdAt: new Date().toISOString(),
        };
        setShares((s) => [item, ...s]);
      } else {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/share", { method: "POST", body: form });
        if (!res.ok) { setUploadError(`Upload failed: HTTP ${res.status}`); return; }
        const item = await res.json() as ShareFile;
        setShares((s) => [item, ...s]);
      }
    } catch (e) {
      setUploadError(`Upload error: ${e}`);
    } finally {
      setUploading(false);
      [photoRef, docRef, anyRef].forEach((r) => { if (r.current) r.current.value = ""; });
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

  useEffect(() => {
    loadShares();
    const t = setInterval(loadShares, 5000);
    return () => clearInterval(t);
  }, []);

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
        body: JSON.stringify({
          messages: next,
          filesTree: fsTree(fsLoad()),
          shares: shares.map((s) => ({ name: s.name, size: s.size, url: s.url })),
        }),
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
    { id: "chat",     label: "CLAUDE" },
  ];

  return (
    <main className="shell">
      <div className="grid-overlay" />

      <header className="topbar">
        <span className="logo">NATIVE<span className="logo-accent">//</span>SHARE</span>
        <button
          className={`hs-pill hs-pill-btn ${computer?.status === "online" ? "on" : "off"}`}
          onClick={() => setTab("computer")}
          title="Go to My Computer"
        >
          <span className="pill-dot" />
          {computer ? `${computer.label} · ${computer.status.toUpperCase()}` : "NO AGENT"}
        </button>
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
          <div className="device-card">
            <span className="device-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="2.5" y="4" width="19" height="12.5" rx="1.2" />
                <path d="M8 20h8M12 16.5V20" strokeLinecap="round" />
              </svg>
            </span>

            <div className="device-main">
              {computerError && <p className="err-text">{computerError}</p>}
              {!computer && !computerError && (
                <p className="empty">No computer registered yet. Start the host agent.</p>
              )}
              {computer && (
                <>
                  <div className="device-name-row">
                    {editingName ? (
                      <input
                        autoFocus
                        className="rename-input device-name-input"
                        value={labelInput}
                        onChange={(e) => setLabelInput(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") { setLabelInput(computer.label); setEditingName(false); }
                        }}
                      />
                    ) : (
                      <button
                        className="device-name"
                        onClick={() => { setLabelInput(computer.label); setEditingName(true); }}
                        title="Rename this computer"
                      >
                        {computer.label}
                        <svg className="edit-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19 3 20l1-4Z" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                    <span className={`hs-pill ${computer.status === "online" ? "on" : "off"}`}>
                      <span className="pill-dot" />
                      {computer.status.toUpperCase()}
                    </span>
                    {savingLabel && <span className="hs-sub saving">SAVING…</span>}
                  </div>
                  <p className="hs-sub">
                    {computer.platform} · v{computer.version} · last seen {new Date(computer.lastSeenAt).toLocaleTimeString()}
                  </p>
                  <div className="device-actions">
                    <button className="text-btn danger" onClick={handleForgetClick}>
                      {confirmForget ? "Click again to confirm" : "Forget this computer"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="section-head">
            <h2 className="pane-title">VIRTUAL FILES</h2>
            <p className="pane-sub">
              A sandboxed file system stored in this browser — create, edit, and delete files/folders,
              and Claude (in the CLAUDE tab) can read and write to it too.
            </p>
          </div>
          <FileExplorer refreshKey={filesVersion} />

          <div className="section-head">
            <h2 className="pane-title">SHARED FILES</h2>
            <p className="pane-sub">
              Files sent via QUICKSHARE — kept in sync here too, and visible to Claude (in the CLAUDE tab).
            </p>
          </div>
          <div className="list">
            {shares.length === 0 && <p className="empty">No shared files yet.</p>}
            {shares.map((s) => (
              <div key={s.id} className="share-card">
                <div className="share-card-head">
                  <strong>{s.name}</strong>
                  <button className="del-btn" onClick={() => deleteShare(s.id)}>✕</button>
                </div>
                <div className="share-meta">
                  <small>{(s.size / 1024).toFixed(1)} KB · {new Date(s.createdAt).toLocaleTimeString()}</small>
                  <a className="share-link" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                </div>
              </div>
            ))}
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
            <span>{uploading ? "UPLOADING..." : dragOver ? "DROP IT!" : "DROP ANY FILE HERE"}</span>
            <div className="browse-row">
              <button className="browse-btn" disabled={uploading} onClick={() => photoRef.current?.click()} type="button">
                PHOTOS / VIDEOS
              </button>
              <button className="browse-btn" disabled={uploading} onClick={() => docRef.current?.click()} type="button">
                DOCUMENTS
              </button>
              <button className="browse-btn" disabled={uploading} onClick={() => anyRef.current?.click()} type="button">
                OTHER
              </button>
            </div>
            <input
              ref={photoRef}
              type="file"
              accept="image/*,video/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
              }}
            />
            <input
              ref={docRef}
              type="file"
              accept={DOC_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
              }}
            />
            <input
              ref={anyRef}
              type="file"
              accept="*/*"
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
                </div>
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
