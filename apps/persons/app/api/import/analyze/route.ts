import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type ContactRef = { id: string; first: string; last: string; headline: string | null; email: string | null; phone: string | null }

function buildSystemPrompt(contacts: ContactRef[]): string {
  const contactList = contacts.length
    ? contacts.map(c => {
        const parts = [`id: "${c.id}"`, `name: "${c.first} ${c.last}"`]
        if (c.headline) parts.push(`role: "${c.headline}"`)
        if (c.email) parts.push(`email: "${c.email}"`)
        if (c.phone) parts.push(`phone: "${c.phone}"`)
        return `  - ${parts.join(", ")}`
      }).join("\n")
    : "  (none yet)"

  return `You are parsing communication history for a personal CRM belonging to Joseph Fryer.

Joseph Fryer is the owner of this CRM. He is the author/sender in every conversation — do NOT create a person entry for him. Every other participant is a contact to extract.

Known contacts already in the CRM:
${contactList}

Data model:
- Person nodes: name, headline/role, tags, closeness (1=acquaintance/no cadence, 2=nurture/professional contact to stay top of mind, 3=friend, 4=inner circle)
- Event nodes: exist independently, have a type (meeting, call, dinner, message, etc)
- Interactions: connect Person nodes TO Events, carry personal metadata

Filename parsing: The source filename often contains critical context — parse it before reading the content:
- Participant names: "Joseph _ Steve 1_1..." → the other participant is Steve
- Meeting type/cadence: "BiWeekly", "Weekly", "1_1", "Standup", "AllHands" → use as eventType hint and in summary
- Dates: filenames like "2024-01-15_meeting.txt" or "Meeting_Jan15.txt" → use as the interaction date
- Match first-name-only participants in the filename against the known contacts list to resolve full names

First, identify the format (Slack, iMessage, WhatsApp, email, SMS, meeting transcript, etc). Then extract ALL people and their interactions.

For meeting transcripts (Zoom, Teams, etc): treat the whole file as one interaction unless there are clearly distinct sessions. Use the filename's meeting type (e.g. "BiWeekly 1:1") as the event title context.

For multi-message threads (text chains, chat exports): group messages into meaningful conversation sessions or topics — NOT one entry per message. A week of back-and-forth about planning a trip is one interaction. Daily check-ins over a month might be 3–5 interactions.

Matching: if a person's name closely matches one in the known contacts list above, set matchedPersonId to their id. Only set it when confident (full name match, or unambiguous first name + context). If the filename names a participant and only one known contact has that first name, use that as the match.

Respond ONLY with a JSON array, no markdown:
[
  {
    "name": "Full Name",
    "isNew": true,
    "needsReview": false,
    "matchedPersonId": null,
    "guessedHeadline": "Role if inferrable, else null",
    "guessedTags": ["tag1", "tag2"],
    "guessedCloseness": 2,
    "closenessReason": "One sentence why",
    "interactions": [
      {
        "eventType": "call|meeting|message|email|dinner|other",
        "date": "YYYY-MM-DD or approximate",
        "summary": "2-3 sentence summary. Be specific about what was discussed.",
        "emotionalWeight": "Energizing|Positive|Neutral|Draining|Stressful",
        "outcome": "Complete|Follow-up needed|Action required|Open",
        "keyTopics": ["topic1", "topic2"]
      }
    ]
  }
]

Rules:
- isNew: true if this person is NOT in the known contacts list
- matchedPersonId: the id string from the known contacts list if matched, otherwise null
- needsReview: true if name is ambiguous AND cannot be resolved from filename context
- Never include Joseph Fryer as a person entry
- closeness: 1=acquaintance (no follow-up cadence), 2=nurture (professional, stay top of mind), 3=friend, 4=inner circle`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { content, filename, existingContacts = [] } = body

    if (!content?.trim()) {
      return NextResponse.json({ error: "No content provided" }, { status: 400 })
    }

    const today = new Date().toISOString().split("T")[0]

    const userPrompt = `Source file: ${filename ?? "pasted content"}
Today's date: ${today}

Content:
---
${content.slice(0, 40000)}
---`

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: buildSystemPrompt(existingContacts),
      messages: [{ role: "user", content: userPrompt }],
    })

    const text = message.content[0].type === "text" ? message.content[0].text : ""

    let parsed
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim()
      parsed = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response", raw: text }, { status: 500 })
    }

    // Ensure matchedPersonId defaults to null if Claude omitted it
    const results = parsed.map((r: Record<string, unknown>) => ({
      matchedPersonId: null,
      matchedPersonName: null,
      ...r,
    }))

    // Resolve matchedPersonName from the contacts list
    for (const r of results) {
      if (r.matchedPersonId) {
        const match = (existingContacts as ContactRef[]).find((c: ContactRef) => c.id === r.matchedPersonId)
        if (match) {
          r.matchedPersonName = `${match.first} ${match.last}`
        } else {
          // Claude hallucinated an id — clear it
          r.matchedPersonId = null
        }
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error("Import analyze error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
