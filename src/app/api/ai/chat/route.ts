import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(request: NextRequest) {
  const { messages } = (await request.json()) as {
    messages: { role: "user" | "assistant"; text: string }[];
  };

  const formatted = messages.map((m) => ({
    role: m.role,
    content: m.text,
  }));

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 512,
    system:
      "You are a hotspot assistant. You help the user manage their WiFi hotspot and connected devices. Be concise.",
    messages: formatted,
  });

  const reply =
    response.content[0].type === "text" ? response.content[0].text : "No response.";

  return NextResponse.json({ reply });
}
