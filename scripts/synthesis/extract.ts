import type Anthropic from "@anthropic-ai/sdk"
import type { TriagedItem, Extraction } from "./types"

export async function extractItems(
  items: TriagedItem[],
  client: Anthropic
): Promise<Array<{ item: TriagedItem; extraction: Extraction | null }>> {
  const worthy = items.filter(i => i.worthExtracting)
  const results: Array<{ item: TriagedItem; extraction: Extraction | null }> = items.map(item => ({
    item,
    extraction: null,
  }))

  for (const item of worthy) {
    const extraction = await extractOne(item, client)
    const idx = results.findIndex(r => r.item.id === item.id)
    if (idx !== -1) results[idx].extraction = extraction
  }

  return results
}

async function extractOne(item: TriagedItem, client: Anthropic): Promise<Extraction | null> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Extract structured information from this communication record. Return a single JSON object matching the schema exactly.

Source: ${item.source}
Timestamp: ${item.timestamp}
Duration: ${item.durationSeconds ? `${Math.round(item.durationSeconds / 60)} minutes` : "unknown"}
Participants: ${item.participants.map(p => p.name ?? p.identifier).join(", ")}
Archive path: ${item.archivePath ?? "n/a"}

Content:
${item.body.slice(0, 4000)}

Required JSON schema:
{
  "event": {
    "type": "meeting" | "call" | "email_thread" | "message_thread",
    "title": string,
    "date": string (ISO),
    "duration_minutes": number (optional),
    "status": "completed" | "upcoming",
    "notes": string (optional, key takeaways),
    "raw_archive_path": string
  },
  "participants": [{
    "name": string,
    "email": string (optional),
    "phone": string (optional),
    "emotional_weight": -2 | -1 | 0 | 1 | 2 (optional, -2=very negative, 2=very positive),
    "outcomes": string[] (optional),
    "action_items": [{"description": string, "deadline": string (optional)}] (optional)
  }],
  "places_mentioned": string[] (optional),
  "plans_mentioned": string[] (optional),
  "my_action_items": [{"description": string, "deadline": string (optional)}] (optional)
}

Return only the JSON object, no other text.`,
      },
    ],
  })

  const text = response.content[0].type === "text" ? response.content[0].text : ""
  return parseExtraction(text)
}

function parseExtraction(text: string): Extraction | null {
  const trimmed = text.trim()
  const jsonStart = trimmed.indexOf("{")
  const jsonEnd = trimmed.lastIndexOf("}")
  if (jsonStart === -1 || jsonEnd === -1) return null

  try {
    return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as Extraction
  } catch {
    return null
  }
}
