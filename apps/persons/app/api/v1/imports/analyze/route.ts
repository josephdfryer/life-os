import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { parseTags } from "@/lib/utils"
import { handleRouteError } from "@/server/api/respond"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type ContactRef = { id: string; first: string; last: string; title: string | null; headline: string | null; emails: string; phones: string }

function buildSystemPrompt(contacts: ContactRef[]): string {
  const contactList = contacts.length
    ? contacts.map(c => {
        const parts = [`id: "${c.id}"`, `name: "${c.first} ${c.last}"`]
        if (c.title) parts.push(`title: "${c.title}"`)
        if (c.headline) parts.push(`headline: "${c.headline}"`)
        const emails = parseTags(c.emails)
        const phones = parseTags(c.phones)
        if (emails[0]) parts.push(`email: "${emails[0]}"`)
        if (phones[0]) parts.push(`phone: "${phones[0]}"`)
        return `  - ${parts.join(", ")}`
      }).join("\n")
    : "  (none yet)"

  return `You are parsing communication history for a personal CRM belonging to Joseph Fryer.

Joseph Fryer is the owner — do NOT create a person entry for him. He is the host/sender in every conversation. Every other participant is a contact.

Known people:
${contactList}

For long transcripts or chat histories: group messages into meaningful conversation sessions or topics — NOT one entry per message. A week of back-and-forth about one topic is one interaction. Daily check-ins over a month are 3–5 interactions max.

If a person's name, email, or phone matches a known contact, set matchedPersonId to their id.

Respond ONLY with a JSON array, no markdown:
[
  {
    "name": "Full Name",
    "isNew": true,
    "needsReview": false,
    "matchedPersonId": null,
    "matchedPersonName": null,
    "guessedHeadline": "Role if inferrable, else null",
    "guessedTags": ["tag1"],
    "guessedCloseness": 2,
    "closenessReason": "One sentence why",
    "interactions": [
      {
        "eventType": "call|meeting|message|email|dinner|other",
        "date": "YYYY-MM-DD",
        "summary": "2-3 sentence summary of what was discussed.",
        "emotionalWeight": "Energizing|Positive|Neutral|Draining|Stressful",
        "outcome": "Complete|Follow-up needed|Action required|Open",
        "keyTopics": ["topic1", "topic2"]
      }
    ]
  }
]`
}

export async function POST(req: NextRequest) {
  if (!(await authorizeApiRequest(req, "ingest.write"))) return unauthorized()

  try {
    const body = await req.json()
    const { content, filename, source } = body as { content: string; filename?: string; source?: string }

    if (!content?.trim()) {
      return NextResponse.json({ error: "content is required" }, { status: 400 })
    }

    const existingContacts = await db.person.findMany({
      select: { id: true, first: true, last: true, title: true, headline: true, emails: true, phones: true },
    })

    const today = new Date().toISOString().split("T")[0]
    const sourceHint = source ? `\nSource system: ${source}` : ""

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: buildSystemPrompt(existingContacts),
      messages: [{
        role: "user",
        content: `File: ${filename ?? "api-content"}${sourceHint}\nToday: ${today}\n\nContent:\n---\n${content.slice(0, 40000)}\n---`,
      }],
    })

    const text = message.content[0].type === "text" ? message.content[0].text : "[]"
    const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim()
    const results = JSON.parse(cleaned) as Record<string, unknown>[]

    const validIds = new Set(existingContacts.map((c: typeof existingContacts[number]) => c.id))
    for (const r of results) {
      if (r.matchedPersonId && !validIds.has(r.matchedPersonId as string)) {
        r.matchedPersonId = null
      }
      if (r.matchedPersonId) {
        const match = existingContacts.find((c: typeof existingContacts[number]) => c.id === r.matchedPersonId)
        r.matchedPersonName = match ? `${match.first} ${match.last}` : null
        r.isNew = false
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    return handleRouteError(error)
  }
}
