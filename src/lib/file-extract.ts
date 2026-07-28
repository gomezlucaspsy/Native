// Turns an uploaded file's raw bytes into plain text Claude can read, so
// QuickShare files are actually interpretable — not just a name/size/URL
// line in the prompt. Handles OOXML archives (.docx/.xlsx/.pptx are zip
// files under the hood), PDFs, generic .zip archives, and plain text/code.

const MAX_OUTPUT_CHARS = 200_000; // ~context-friendly per read, matches My Computer's read cap
const MAX_ZIP_MEMBER_CHARS = 20_000; // per-file budget when unpacking a generic .zip
const MAX_ZIP_MEMBERS = 30;

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".yml", ".yaml", ".xml", ".csv",
  ".log", ".ini", ".cfg", ".conf",
  ".cs", ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs",
  ".html", ".css", ".sql", ".sh", ".ps1",
]);

function truncate(text: string, limit = MAX_OUTPUT_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… (truncated, showing first ${Math.round(limit / 1000)}KB)`;
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value.trim() || "(document has no readable text)";
}

async function extractXlsx(buffer: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`--- sheet: ${sheetName} ---\n${csv.trim() || "(empty sheet)"}`);
  }
  return parts.join("\n\n") || "(workbook has no sheets)";
}

async function extractPptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    });

  const slides: string[] = [];
  for (const [i, name] of slideFiles.entries()) {
    const xml = await zip.files[name].async("text");
    // Slide text lives in <a:t>...</a:t> runs; strip everything else.
    const text = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
      .map((m) => m[1])
      .join(" ")
      .trim();
    slides.push(`--- slide ${i + 1} ---\n${text || "(no text)"}`);
  }
  return slides.join("\n\n") || "(presentation has no slides)";
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const { text } = await parser.getText();
    return text.trim() || "(PDF has no extractable text — it may be scanned/image-only)";
  } finally {
    await parser.destroy();
  }
}

async function extractZip(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((f) => !f.dir);

  const listing = entries.map((f) => f.name).join("\n") || "(empty archive)";
  const parts = [`Archive contents (${entries.length} file${entries.length === 1 ? "" : "s"}):`, listing];

  let shown = 0;
  for (const entry of entries) {
    if (shown >= MAX_ZIP_MEMBERS) {
      parts.push(`\n… (stopped after ${MAX_ZIP_MEMBERS} files; ask to read a specific archive member by extending this tool if needed)`);
      break;
    }
    const ext = extOf(entry.name);
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const text = await entry.async("text");
    parts.push(`\n--- ${entry.name} ---\n${truncate(text, MAX_ZIP_MEMBER_CHARS)}`);
    shown++;
  }

  return parts.join("\n");
}

export interface ExtractResult {
  ok: boolean;
  text: string;
}

// Best-effort content extraction keyed off the file extension. Anything
// unrecognized (images, audio/video, legacy .doc/.ppt binaries, executables)
// reports back clearly instead of silently returning nothing.
export async function extractText(buffer: Buffer, filename: string): Promise<ExtractResult> {
  const ext = extOf(filename);
  try {
    if (TEXT_EXTENSIONS.has(ext)) {
      return { ok: true, text: truncate(buffer.toString("utf-8")) };
    }
    switch (ext) {
      case ".docx":
        return { ok: true, text: truncate(await extractDocx(buffer)) };
      case ".xlsx":
        return { ok: true, text: truncate(await extractXlsx(buffer)) };
      case ".pptx":
        return { ok: true, text: truncate(await extractPptx(buffer)) };
      case ".pdf":
        return { ok: true, text: truncate(await extractPdf(buffer)) };
      case ".zip":
        return { ok: true, text: truncate(await extractZip(buffer)) };
      case ".doc":
      case ".ppt":
      case ".xls":
        return {
          ok: false,
          text: `'${filename}' is a legacy binary Office format (${ext}) — only the modern XML-based formats (.docx/.xlsx/.pptx) can be parsed. Ask the user to re-save it in the modern format.`,
        };
      default:
        return {
          ok: false,
          text: `'${filename}' has an unsupported file type (${ext || "no extension"}) — it looks like a binary/media file that can't be turned into text.`,
        };
    }
  } catch (err) {
    return { ok: false, text: `Could not parse '${filename}': ${String(err)}` };
  }
}
