import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      system:
        "You are a WiFi hotspot assistant built into Native Share. You help the user manage their hotspot, see connected devices, and share files via QR code. Be concise and practical.",
      messages: apiMessages,
    });

    const reply =
      response.content[0].type === "text"
        ? response.content[0].text
        : "No response.";

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Claude error:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
