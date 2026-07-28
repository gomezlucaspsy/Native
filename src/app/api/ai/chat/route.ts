import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { enqueueCommand, getOnlineAgent, waitForCommand } from "@/lib/control-plane";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// How long to wait for the host agent to pick up, execute, and report back a
// file-access command. The agent polls on HOST_AGENT_POLL_INTERVAL_SECS
// (default 15s), so this needs headroom above that.
const TOOL_RESULT_TIMEOUT_MS = 40_000;
const MAX_TOOL_TURNS = 6;

const tools: Anthropic.Tool[] = [
  {
    name: "list_computer_files",
    description:
      "List the files and folders in a directory on the user's computer (My Computer), so you can discover what's available before reading one. Path is relative to the shared root folder.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative directory path, e.g. 'Projects'. Omit or leave empty for the root.",
        },
      },
    },
  },
  {
    name: "read_computer_file",
    description:
      "Read the text contents of a file on the user's computer (My Computer), so you can ground your answer in the user's own documents — similar to reading an uploaded source. Only text/code/doc files can be read (not images, archives, or executables).",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path, e.g. 'notes/todo.md'.",
        },
      },
      required: ["path"],
    },
  },
];

async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const agent = getOnlineAgent();
  if (!agent) {
    return {
      isError: true,
      text: "My Computer isn't connected right now — the host agent must be online to browse or read files.",
    };
  }

  if (name === "read_computer_file") {
    const path = typeof input.path === "string" ? input.path : "";
    if (!path.trim()) {
      return { isError: true, text: "path is required to read a file." };
    }
    const command = enqueueCommand({
      agentId: agent.agentId,
      type: "read_file",
      payload: { path },
    });
    const result = await waitForCommand(agent.agentId, command.id, TOOL_RESULT_TIMEOUT_MS);
    if (!result || result.status !== "completed") {
      return {
        isError: true,
        text: result?.result ?? "Timed out waiting for My Computer to respond.",
      };
    }
    return { isError: false, text: result.result ?? "(empty file)" };
  }

  if (name === "list_computer_files") {
    const path = typeof input.path === "string" ? input.path : "";
    const command = enqueueCommand({
      agentId: agent.agentId,
      type: "list_files",
      payload: { path },
    });
    const result = await waitForCommand(agent.agentId, command.id, TOOL_RESULT_TIMEOUT_MS);
    if (!result || result.status !== "completed") {
      return {
        isError: true,
        text: result?.result ?? "Timed out waiting for My Computer to respond.",
      };
    }
    return { isError: false, text: result.result ?? "(empty directory)" };
  }

  return { isError: true, text: `unknown tool: ${name}` };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      messages: { role: "user" | "assistant"; text: string }[];
    };

    // Anthropic requires messages alternate user/assistant and start with user
    const apiMessages: Anthropic.MessageParam[] = body.messages
      .filter((m) => m.text?.trim())
      .map((m) => ({ role: m.role, content: m.text }));

    // Safety: ensure first message is user
    if (!apiMessages.length || apiMessages[0].role !== "user") {
      return NextResponse.json({ reply: "Send a message to get started." });
    }

    const system =
      "You are the assistant built into Native Share. You help the user check on their computer's status, share files via QR code, and — like NotebookLM does with uploaded sources — you can browse and read files on the user's computer (My Computer) using the list_computer_files and read_computer_file tools to ground your answers in their own documents. Only use those tools when the user asks about their computer's files or content that would live there; don't reach for them for general questions. Be concise and practical, and say clearly if My Computer isn't connected.";

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
        const { text, isError } = await runTool(
          block.name,
          (block.input as Record<string, unknown>) ?? {},
        );
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
