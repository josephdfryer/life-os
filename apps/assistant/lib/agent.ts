import Anthropic from "@anthropic-ai/sdk"
import { TOOLS, executeTool } from "@/lib/tools"
import { db } from "@/lib/db"

const WORKSPACE_ID = process.env.LIFE_OS_WORKSPACE_ID ?? "default-workspace"
const MODEL = "claude-sonnet-4-6"
const MAX_HISTORY = 30
const MAX_TOOL_ROUNDS = 8
const TZ = "America/Los_Angeles"

function systemPrompt(channel: "whatsapp" | "web") {
  const now = new Date().toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
  const style = channel === "whatsapp"
    ? "This is WhatsApp: be brief and conversational. Plain text only — no markdown, no bullets unless truly needed."
    : "This is a web chat: still concise, but markdown is fine."
  return [
    `You are Joseph's Life OS assistant. Current time: ${now} (Las Vegas).`,
    "You have live tools over his life graph: people and relationships, schedule, captured notes, spending (synced from his bank via Era, location-matched to real places), and the review inbox.",
    "Use tools instead of guessing — search before answering about a person; query finance before quoting numbers. Chain tools when needed.",
    "When Joseph asks you to remember/note/capture something, use capture_note (declarations for values/commitments, observations for things noticed, thoughts for everything else).",
    "When he mentions having talked to or met someone, offer to log it — but only log_interaction after he confirms, and search_people first to get the right id.",
    "Never invent data. If a tool returns nothing, say so.",
    style,
  ].join(" ")
}

export async function runAgent(input: {
  channel: "whatsapp" | "web"
  from: string
  userMessage: string
}): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const history = await db.assistantMessage.findMany({
    where: { workspaceId: WORKSPACE_ID, from: input.from },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY,
  })

  const messages: Anthropic.MessageParam[] = [
    ...history.reverse().map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: input.userMessage },
  ]

  let finalText = ""
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt(input.channel),
      tools: TOOLS,
      messages,
    })

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("")

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      finalText = text || "…"
      break
    }

    messages.push({ role: "assistant", content: response.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const use of toolUses) {
      const output = await executeTool(use.name, (use.input ?? {}) as Record<string, unknown>)
      results.push({ type: "tool_result", tool_use_id: use.id, content: output })
    }
    messages.push({ role: "user", content: results })

    if (round === MAX_TOOL_ROUNDS) {
      finalText = text || "I ran out of steps working on that — try narrowing the question."
    }
  }

  await db.assistantMessage.createMany({
    data: [
      { workspaceId: WORKSPACE_ID, channel: input.channel, from: input.from, role: "user", content: input.userMessage },
      { workspaceId: WORKSPACE_ID, channel: input.channel, from: input.from, role: "assistant", content: finalText },
    ],
  })

  return finalText
}
