import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { validateApiKey, unauthorized } from "@/lib/api-auth"
import { assignColor } from "@/lib/colors"
import { storeFile } from "@/lib/file-storage"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!validateApiKey(req)) return unauthorized()

  try {
    let content: string
    let filename: string
    let source: string | null = null

    const contentType = req.headers.get("content-type") ?? ""

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData()
      const file = form.get("file") as File | null
      if (!file) return NextResponse.json({ error: "No file field in form data" }, { status: 400 })
      content = await file.text()
      filename = file.name
      source = (form.get("source") as string | null) ?? null
    } else {
      const body = await req.json()
      content = body.content
      filename = body.filename ?? "api-ingest"
      source = body.source ?? null
    }

    if (!content?.trim()) {
      return NextResponse.json({ error: "No content provided" }, { status: 400 })
    }

    // Load existing contacts for matching
    const existingPersons = await db.person.findMany({
      select: { id: true, first: true, last: true, headline: true, email: true, phone: true },
    })

    // Run Claude analysis
    const analysisResult = await analyzeWithClaude(content, filename, source, existingPersons)

    // Store the file
    const fileRecord = await storeFile(filename, source ?? "api", content)

    // Persist everything — auto-confirm, no UI interaction needed
    const existingCount = await db.person.count()
    const created: { action: string; personId: string; name: string; interactionsCreated: number }[] = []

    for (let i = 0; i < analysisResult.length; i++) {
      const result = analysisResult[i]

      let personId: string | null = null

      // 1. Use Claude's explicit match if valid
      if (result.matchedPersonId) {
        const match = await db.person.findUnique({ where: { id: result.matchedPersonId } })
        if (match) personId = match.id
      }

      // 2. Fallback: exact name match
      if (!personId && !result.isNew) {
        const parts = result.name.trim().split(/\s+/)
        const first = parts[0]
        const last = parts.slice(1).join(" ")
        const match = await db.person.findFirst({
          where: { first: { equals: first }, last: { equals: last } },
        })
        if (match) personId = match.id
      }

      // 3. Create new person
      let action = "matched"
      if (!personId) {
        action = "created"
        const parts = result.name.trim().split(/\s+/)
        const first = parts[0] || result.name
        const last = parts.slice(1).join(" ") || ""
        const { color, colorSoft } = assignColor(existingCount + i)

        const person = await db.person.create({
          data: {
            first,
            last,
            headline: result.guessedHeadline || null,
            closeness: result.guessedCloseness ?? 2,
            tags: JSON.stringify(result.guessedTags ?? []),
            values: JSON.stringify([]),
            color,
            colorSoft,
          },
        })
        personId = person.id
      }

      // Create interaction + event for each entry
      let interactionsCreated = 0
      for (const ix of result.interactions) {
        const timestamp = parseDate(ix.date)

        const event = await db.event.create({
          data: {
            name: ix.summary?.slice(0, 80) ?? `${ix.eventType} with ${result.name}`,
            type: ix.eventType,
            timestamp,
          },
        })

        await db.interaction.create({
          data: {
            personId: personId!,
            eventId: event.id,
            type: ix.eventType,
            timestamp,
            summary: ix.summary || null,
            emotionalWeight: ix.emotionalWeight || null,
            outcome: ix.outcome || null,
            actionItems: ix.keyTopics?.length ? JSON.stringify(ix.keyTopics) : null,
            sourceFileId: fileRecord.id,
          },
        })
        interactionsCreated++
      }

      created.push({ action, personId: personId!, name: result.name, interactionsCreated })
    }

    return NextResponse.json({
      fileId: fileRecord.id,
      filename: fileRecord.filename,
      retrieveUrl: `/api/v1/files/${fileRecord.id}`,
      source,
      persons: created,
      totalInteractions: created.reduce((s, p) => s + p.interactionsCreated, 0),
    }, { status: 201 })

  } catch (error) {
    console.error("Ingest error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ingest failed" },
      { status: 500 }
    )
  }
}

// ─── Claude analysis ─────────────────────────────────────────────────────────

type ContactRef = { id: string; first: string; last: string; headline: string | null; email: string | null; phone: string | null }
type AnalyzedPerson = {
  name: string
  isNew: boolean
  matchedPersonId: string | null
  guessedHeadline: string | null
  guessedTags: string[]
  guessedCloseness: number
  interactions: { eventType: string; date: string; summary: string; emotionalWeight: string; outcome: string; keyTopics: string[] }[]
}

async function analyzeWithClaude(
  content: string,
  filename: string,
  source: string | null,
  contacts: ContactRef[]
): Promise<AnalyzedPerson[]> {
  const contactList = contacts.length
    ? contacts.map(c => {
        const parts = [`id: "${c.id}"`, `name: "${c.first} ${c.last}"`]
        if (c.headline) parts.push(`role: "${c.headline}"`)
        if (c.email) parts.push(`email: "${c.email}"`)
        if (c.phone) parts.push(`phone: "${c.phone}"`)
        return `  - ${parts.join(", ")}`
      }).join("\n")
    : "  (none yet)"

  const sourceHint = source ? `\nSource system: ${source}` : ""

  const systemPrompt = `You are parsing communication history for a personal CRM belonging to Joseph Fryer.

Joseph Fryer is the owner — do NOT create a person entry for him. He is the host/sender in every conversation. Every other participant is a contact.

Known contacts:
${contactList}

For long transcripts or chat histories: group messages into meaningful conversation sessions or topics — NOT one entry per message. A week of back-and-forth about one topic is one interaction. Daily check-ins over a month are 3–5 interactions max.

If a person's name, email, or phone matches a known contact, set matchedPersonId to their id.

Respond ONLY with a JSON array, no markdown:
[
  {
    "name": "Full Name",
    "isNew": true,
    "matchedPersonId": null,
    "guessedHeadline": "Role if inferrable, else null",
    "guessedTags": ["tag1"],
    "guessedCloseness": 2,
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

  const today = new Date().toISOString().split("T")[0]
  const userPrompt = `File: ${filename}${sourceHint}
Today: ${today}

Content:
---
${content.slice(0, 40000)}
---`

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  })

  const text = message.content[0].type === "text" ? message.content[0].text : "[]"
  const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim()
  const parsed = JSON.parse(cleaned) as AnalyzedPerson[]

  // Validate matchedPersonId values — Claude can hallucinate IDs
  const validIds = new Set(contacts.map(c => c.id))
  for (const p of parsed) {
    if (p.matchedPersonId && !validIds.has(p.matchedPersonId)) {
      p.matchedPersonId = null
    }
    if (p.matchedPersonId) p.isNew = false
  }

  return parsed
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  if (!dateStr) return new Date()
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (match) return new Date(dateStr)
  return new Date()
}
