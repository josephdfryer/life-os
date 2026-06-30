import Anthropic from "@anthropic-ai/sdk"
import { formatContextForPrompt, loadContext } from "@/lib/context"
import { db } from "@/lib/db"

const WORKSPACE_ID = process.env.LIFE_OS_WORKSPACE_ID ?? "default-workspace"
const MODEL = "claude-sonnet-4-6"
const MAX_HISTORY = 5

const SYSTEM_PROMPT = `You are Joseph's personal Life OS assistant, reachable via WhatsApp. You have access to his relationship graph, calendar, and task list. Be concise — this is a text conversation, not a document. Answer in plain text, no markdown. When Joseph asks about his day, tasks, people, or relationships, use the context provided. You can also just chat.`

export async function callClaude(from: string, userMessage: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const [history, ctx] = await Promise.all([
    db.assistantMessage.findMany({
      where: { workspaceId: WORKSPACE_ID, from },
      orderBy: { createdAt: "desc" },
      take: MAX_HISTORY,
    }),
    loadContext(),
  ])

  const contextBlock = formatContextForPrompt(ctx)
  const systemWithContext = contextBlock
    ? `${SYSTEM_PROMPT}\n\nCURRENT CONTEXT:\n${contextBlock}`
    : SYSTEM_PROMPT

  const messages: Anthropic.MessageParam[] = [
    ...history
      .reverse()
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userMessage },
  ]

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemWithContext,
    messages,
  })

  const assistantText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")

  await db.assistantMessage.createMany({
    data: [
      { workspaceId: WORKSPACE_ID, channel: "whatsapp", from, role: "user", content: userMessage },
      { workspaceId: WORKSPACE_ID, channel: "whatsapp", from, role: "assistant", content: assistantText },
    ],
  })

  return assistantText
}
