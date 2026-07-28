// A sandboxed, client-only "computer" filesystem — no server, no database.
// Everything lives in the browser's localStorage, so Claude and the user can
// both create/edit/delete files and folders that only exist for this browser.

export type FsFile = { type: "file"; content: string; created: string; modified: string };
export type FsFolder = { type: "folder"; created: string };
export type FsNode = FsFile | FsFolder;
export type FsMap = Record<string, FsNode>;

export type FsListItem = { name: string; path: string } & FsNode;

export type FsAction = {
  action: "create" | "update" | "delete";
  path: string;
  name?: string;
  type?: "file" | "folder";
  content?: string;
};

const STORAGE_KEY = "native:vfs";

export function fsLoad(): FsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FsMap) : {};
  } catch {
    return {};
  }
}

export function fsSave(fs: FsMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fs));
  } catch {
    // storage full/unavailable — silently no-op, same as a no-op write to disk
  }
}

// Returns files/folders that are direct children of folderPath ("/" = root).
export function fsList(fs: FsMap, folderPath: string): FsListItem[] {
  const prefix = folderPath === "/" ? "/" : `${folderPath}/`;
  const seen = new Set<string>();
  const items: FsListItem[] = [];

  for (const [p, node] of Object.entries(fs)) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      if (!seen.has(p)) {
        seen.add(p);
        items.push({ name: rest, path: p, ...node });
      }
    } else {
      const dirName = rest.slice(0, slash);
      const dirPath = prefix + dirName;
      if (!seen.has(dirPath)) {
        seen.add(dirPath);
        items.push({ name: dirName, path: dirPath, type: "folder", created: new Date(0).toISOString() });
      }
    }
  }

  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// Compact tree listing, used as Claude's context for the "computer" tab.
export function fsTree(fs: FsMap): string {
  const keys = Object.keys(fs).sort();
  if (!keys.length) return "(empty)";
  return keys
    .map((p) => {
      const n = fs[p];
      return n.type === "folder" ? `${p}/` : `${p} (${n.content.length} chars)`;
    })
    .join("\n");
}

export function fsApplyAction(fs: FsMap, action: FsAction): FsMap {
  const next = { ...fs };
  const fullPath =
    action.name != null
      ? action.path === "/"
        ? `/${action.name}`
        : `${action.path}/${action.name}`
      : action.path;

  if (action.action === "delete") {
    for (const key of Object.keys(next)) {
      if (key === fullPath || key.startsWith(`${fullPath}/`)) delete next[key];
    }
    return next;
  }

  const now = new Date().toISOString();
  if (action.type === "folder") {
    next[fullPath] = { type: "folder", created: now };
  } else {
    const existing = next[fullPath];
    next[fullPath] = {
      type: "file",
      content: action.content ?? "",
      created: existing?.type === "file" ? existing.created : now,
      modified: now,
    };
  }
  return next;
}
