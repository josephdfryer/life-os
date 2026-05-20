import type Anthropic from "@anthropic-ai/sdk"
import type { RawItem, TriagedItem } from "./types"

const BATCH_SIZE = 20

export async function triageItems(items: RawItem[], client: Anthropic): Promise<TriagedItem[]> {
  if (items.length === 0) return []

  const results: TriagedItem[] = []

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    const triaged = await triageBatch(batch, client)
    results.push(...triaged)
  }

  return results
}

async function triageBatch(batch: RawItem[], client: Anthropic): Promise<TriagedItem[]> {
  const prompt = batch
    .map(
      (item, idx) =>
        `[${idx}] source=${item.source} from=${item.participants.map(p => p.name ?? p.identifier).join(",")} ts=${item.timestamp}\n${item.body.slice(0, 300)}`
    )
    .join("\n\n")

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are triaging communication records to decide which are worth deep extraction.

For each numbered item below, output a JSON line: {"idx": N, "extract": true/false, "reason": "brief reason"}

Extract=true if the item contains meaningful content: substantive conversation, meeting notes, action items, relationship context, plans, or emotional significance.
Extract=false if: automated/spam, receipts, OTP codes, empty/one-word messages, or trivial acknowledgments.

Items:
${prompt}

Output one JSON line per item, nothing else.`,
      },
    ],
  })

  const text = response.content[0].type === "text" ? response.content[0].text : ""
  const decisions = parseTriageResponse(text, batch.length)

  return batch.map((item, idx) => ({
    ...item,
    worthExtracting: decisions[idx]?.extract ?? false,
    triageReason: decisions[idx]?.reason ?? "no response",
  }))
}

function parseTriageResponse(
  text: string,
  count: number
): Record<number, { extract: boolean; reason: string }> {
  const result: Record<number, { extract: boolean; reason: string }> = {}
  const lines = text.trim().split("\n")

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("{")) continue
    try {
      const parsed = JSON.parse(trimmed) as { idx: number; extract: boolean; reason: string }
      if (typeof parsed.idx === "number" && parsed.idx >= 0 && parsed.idx < count) {
        result[parsed.idx] = { extract: Boolean(parsed.extract), reason: parsed.reason ?? "" }
      }
    } catch {
      // skip malformed lines
    }
  }

  return result
}
