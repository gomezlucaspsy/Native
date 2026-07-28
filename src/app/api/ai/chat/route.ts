import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { extractText } from "@/lib/file-extract";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_TOOL_TURNS = 6;
const MAX_FETCH_BYTES = 25 * 1024 * 1024; // 25MB — plenty for docs, guards against pathological uploads

interface ShareInfo {
  name: string;
  size: number;
  url: string;
}

const tools: Anthropic.Tool[] = [
  {
    name: "read_shared_file",
    description:
      "Read and interpret the contents of a file the user shared via QuickShare — including archive-based formats like .docx, .xlsx, .pptx, and .zip (unpacked and converted to text), plus .pdf and plain text/code files. Use this whenever the user asks about the content of a shared file, not just its name or size.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The exact file name of the shared file to read, as listed in the shared files context.",
        },
      },
      required: ["name"],
    },
  },
];

async function readSharedFile(shares: ShareInfo[], name: string): Promise<{ text: string; isError: boolean }> {
  const share = shares.find((s) => s.name === name);
  if (!share) {
    const available = shares.length ? shares.map((s) => s.name).join(", ") : "(no shared files)";
    return { isError: true, text: `No shared file named '${name}'. Available: ${available}` };
  }

  let res: Response;
  try {
    res = await fetch(share.url);
  } catch (err) {
    return { isError: true, text: `Could not fetch '${name}': ${String(err)}` };
  }
  if (!res.ok) {
    return { isError: true, text: `Could not fetch '${name}': HTTP ${res.status}` };
  }

  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_FETCH_BYTES) {
    return {
      isError: true,
      text: `'${name}' is ${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB, too large to read (limit ${MAX_FETCH_BYTES / 1024 / 1024}MB).`,
    };
  }

  const { ok, text } = await extractText(Buffer.from(arrayBuffer), name);
  return { isError: !ok, text };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      messages: { role: "user" | "assistant"; text: string }[];
      filesTree?: string;
      shares?: ShareInfo[];
    };

    // Anthropic requires messages alternate user/assistant and start with user
    const apiMessages: Anthropic.MessageParam[] = body.messages
      .filter((m) => m.text?.trim())
      .map((m) => ({ role: m.role, content: m.text }));

    // Safety: ensure first message is user
    if (!apiMessages.length || apiMessages[0].role !== "user") {
      return NextResponse.json({ reply: "Send a message to get started." });
    }

    const shares = body.shares ?? [];
    const sharesTree = shares.length
      ? shares.map((s) => `${s.name} (${(s.size / 1024).toFixed(1)} KB) → ${s.url}`).join("\n")
      : "(no shared files yet)";

    const system = [
      "You are the assistant built into Native Share. You help the user check on their computer's status and share files via QR code. Be concise and practical.",
      "The user also has a sandboxed virtual filesystem in the MY COMPUTER tab (browser-only, not the real disk). Current contents:",
      body.filesTree?.trim() || "(empty)",
      "The user has also shared files via QUICKSHARE (also listed under MY COMPUTER → SHARED FILES). These are real uploaded files. Current shared files:",
      sharesTree,
      "To actually read and interpret a shared file's content — including archive formats like .docx, .xlsx, .pptx, and .zip, plus .pdf and plain text/code — call the read_shared_file tool with its exact name. Don't guess at a file's contents from its name/size alone; read it first.",
      "You can create, update, or delete an entry in the virtual filesystem by ending your reply with a single fenced block in this exact format (only when the user actually asks you to manage a file/folder):",
      '```file-action\n{"action":"create","path":"/","name":"notes.txt","type":"file","content":"hello"}\n```',
      'action is one of "create" | "update" | "delete". type is "file" | "folder" (omit for delete). path is the parent folder ("/" for root); name is required for create/update. Only include this block when actually performing a file operation.',
    ].join("\n\n");

    let reply = "Sorry, I couldn't finish that.";

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const response = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system,
        messages: apiMessages,
        tools,
      });

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
        const textBlock = response.content.find(
          (block): block is Anthropic.TextBlock => block.type === "text",
        );
        reply = textBlock?.text ?? "No response.";
        break;
      }

      apiMessages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const input = (block.input as Record<string, unknown>) ?? {};
        const name = typeof input.name === "string" ? input.name : "";
        const { text, isError } = await readSharedFile(shares, name);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: text,
          is_error: isError,
        });
      }

      apiMessages.push({ role: "user", content: toolResults });
    }

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Claude error:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
