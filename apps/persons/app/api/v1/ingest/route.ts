import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { storeFile } from "@/lib/file-storage"
import { handleRouteError } from "@/server/api/respond"
import { confirmImport } from "@/server/domain/imports"
import type { ImportedPerson } from "@/types"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "ingest.write")
  if (!auth) return unauthorized()

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

    // Load existing people for matching — scoped to this API key's workspace
    // so Claude never sees (and can never "match" against) another tenant's contacts.
    const existingPersons = await db.person.findMany({
      where: { workspaceId: auth.workspaceId },
      select: { id: true, first: true, last: true, title: true, headline: true, emails: true, phones: true },
    })

    // Run Claude analysis
    const analysisResult = await analyzeWithClaude(content, filename, source, existingPersons)

    // Store the file
    const fileRecord = await storeFile(filename, source ?? "api", content)

    const { created } = await confirmImport(toImportedPersons(analysisResult), auth.workspaceId, {
      importedFileId: fileRecord.id,
      actor: auth.actor,
    })
    const persons = created.map(person => ({
      action: person.action,
      personId: person.personId,
      name: person.name,
      interactionsCreated: person.interactionCount,
    }))

    return NextResponse.json({
      fileId: fileRecord.id,
      filename: fileRecord.filename,
      retrieveUrl: `/api/v1/files/${fileRecord.id}`,
      source,
      persons,
      totalInteractions: persons.reduce((s, p) => s + p.interactionsCreated, 0),
    }, { status: 201 })

  } catch (error) {
    return handleRouteError(error)
  }
}

// ─── Claude analysis ─────────────────────────────────────────────────────────

type ContactRef = { id: string; first: string; last: string; title: string | null; headline: string | null; emails: string; phones: string }
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
        if (c.title) parts.push(`title: "${c.title}"`)
        if (c.headline) parts.push(`headline: "${c.headline}"`)
        const emails = JSON.parse(c.emails) as string[]
        const phones = JSON.parse(c.phones) as string[]
        if (emails[0]) parts.push(`email: "${emails[0]}"`)
        if (phones[0]) parts.push(`phone: "${phones[0]}"`)
        return `  - ${parts.join(", ")}`
      }).join("\n")
    : "  (none yet)"

  const sourceHint = source ? `\nSource system: ${source}` : ""

  const systemPrompt = `You are parsing communication history for a personal CRM belonging to Joseph Fryer.

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

function toImportedPersons(results: AnalyzedPerson[]): ImportedPerson[] {
  return results.map(result => ({
    ...result,
    needsReview: false,
    closenessReason: "",
    matchedPersonName: null,
  }))
}
