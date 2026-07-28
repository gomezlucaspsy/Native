"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fsApplyAction, fsList, fsLoad, fsSave, type FsListItem } from "@/lib/virtual-fs";

const EXT_BADGES: Record<string, string> = {
  js: "JS", jsx: "JSX", ts: "TS", tsx: "TSX", py: "PY", cs: "C#",
  java: "JV", cpp: "C+", go: "GO", rs: "RS", html: "HT", css: "CS",
  json: "JN", yaml: "YM", yml: "YM", sh: "SH", sql: "SQ", md: "MD", txt: "TX",
};

function badge(name: string): string {
  const parts = name.split(".");
  const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : "";
  return EXT_BADGES[ext] ?? (ext ? ext.toUpperCase().slice(0, 2) : "??");
}

export type FileExplorerHandle = { refresh: () => void };

export default function FileExplorer({ refreshKey }: { refreshKey?: number }) {
  const [path, setPath] = useState("/");
  const [items, setItems] = useState<FsListItem[]>([]);
  const [selected, setSelected] = useState<FsListItem | null>(null);
  const [content, setContent] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const [adding, setAdding] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [addError, setAddError] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(() => {
    setItems(fsList(fsLoad(), path));
  }, [path]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);
  useEffect(() => { if (selected) textareaRef.current?.focus(); }, [selected]);

  function openItem(item: FsListItem) {
    if (item.type === "folder") {
      setPath(item.path);
      setSelected(null);
      setContent("");
      return;
    }
    setSelected(item);
    setSaveMsg("");
    setContent(item.content);
  }

  function saveFile() {
    if (!selected) return;
    const fs = fsApplyAction(fsLoad(), { action: "update", path, name: selected.name, type: "file", content });
    fsSave(fs);
    setSaveMsg("SAVED");
    refresh();
    setTimeout(() => setSaveMsg(""), 1500);
  }

  function deleteItem(item: FsListItem, e?: React.MouseEvent) {
    e?.stopPropagation();
    const fs = fsApplyAction(fsLoad(), { action: "delete", path: item.path });
    fsSave(fs);
    if (selected?.path === item.path) { setSelected(null); setContent(""); }
    refresh();
  }

  function createEntry() {
    const name = newName.trim();
    if (!name) { setAddError("Name required."); return; }
    const fullPath = path === "/" ? `/${name}` : `${path}/${name}`;
    if (fsLoad()[fullPath]) { setAddError("Already exists."); return; }
    const fs = fsApplyAction(fsLoad(), {
      action: "create",
      path,
      name,
      type: adding === "folder" ? "folder" : "file",
      content: newContent,
    });
    fsSave(fs);
    setNewName(""); setNewContent(""); setAdding(null); setAddError("");
    refresh();
  }

  const crumbs = [
    { label: "root", path: "/" },
    ...(path === "/" ? [] : path.split("/").filter(Boolean).map((p, i, arr) => ({
      label: p, path: `/${arr.slice(0, i + 1).join("/")}`,
    }))),
  ];

  return (
    <div className="explorer">
      <div className="explorer-side">
        <div className="explorer-crumbs">
          {crumbs.map((c, i) => (
            <span key={c.path} className="crumb">
              {i > 0 && <span className="crumb-sep">/</span>}
              <button onClick={() => { setPath(c.path); setSelected(null); setContent(""); }}>
                {c.label}
              </button>
            </span>
          ))}
        </div>

        <div className="explorer-toolbar">
          <button
            className="browse-btn"
            onClick={() => { setAdding((v) => (v === "file" ? null : "file")); setAddError(""); }}
          >
            {adding === "file" ? "CANCEL" : "+ FILE"}
          </button>
          <button
            className="browse-btn"
            onClick={() => { setAdding((v) => (v === "folder" ? null : "folder")); setAddError(""); }}
          >
            {adding === "folder" ? "CANCEL" : "+ DIR"}
          </button>
        </div>

        {adding && (
          <div className="explorer-add-form">
            <input
              autoFocus
              className="rename-input"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setAddError(""); }}
              placeholder={adding === "folder" ? "folder-name" : "filename.txt"}
            />
            {adding === "file" && (
              <textarea
                className="explorer-textarea small"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Content..."
                rows={4}
              />
            )}
            {addError && <p className="err-text">{addError}</p>}
            <button className="hs-btn primary" onClick={createEntry}>CREATE</button>
          </div>
        )}

        <div className="explorer-list">
          {items.length === 0 && <p className="empty" style={{ padding: "0.75rem" }}>Empty folder.</p>}
          {items.map((item) => (
            <div
              key={item.path}
              className={`explorer-item ${selected?.path === item.path ? "active" : ""}`}
              onClick={() => openItem(item)}
            >
              <span className={`explorer-badge ${item.type === "folder" ? "dir" : ""}`}>
                {item.type === "folder" ? "DIR" : badge(item.name)}
              </span>
              <span className="explorer-item-name">{item.name}</span>
              <button className="explorer-item-del" onClick={(e) => deleteItem(item, e)}>✕</button>
            </div>
          ))}
        </div>
      </div>

      <div className="explorer-main">
        {selected ? (
          <>
            <div className="explorer-editor-head">
              <span className="explorer-editor-path">{selected.path}</span>
              {saveMsg && <span className="explorer-save-msg">{saveMsg}</span>}
              <button className="hs-btn primary compact" onClick={saveFile}>SAVE</button>
              <button className="hs-btn danger compact" onClick={(e) => deleteItem(selected, e)}>DELETE</button>
            </div>
            <textarea
              ref={textareaRef}
              className="explorer-textarea"
              value={content}
              spellCheck={false}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveFile(); }
              }}
            />
          </>
        ) : (
          <div className="explorer-empty">
            <span>Select a file to edit</span>
            <span className="explorer-empty-hint">Ctrl+S to save</span>
          </div>
        )}
      </div>
    </div>
  );
}
