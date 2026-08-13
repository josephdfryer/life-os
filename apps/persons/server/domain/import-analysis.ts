import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import type { ImportedPerson } from "@/types"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// The shared AI contact-history analyzer behind both /api/v1/ingest and
// /api/v1/imports/analyze — those two routes had drifted into separate,
// nearly-identical implementations, one of which (imports/analyze) was
// missing workspace scoping on its "known people" query entirely.

type ContactRef = { id: string; first: string; last: string; title: string | null; headline: string | null; emails: string; phones: string }

/**
 * The display name substituted into the analysis prompt in place of the
 * previously hardcoded "Joseph Fryer" — every workspace, not just the
 * founder's, needs the AI to correctly identify its own owner as the host
 * rather than as a contact to create.
 */
export async function resolveWorkspaceOwnerName(workspaceId: string): Promise<string> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      ownerUserId: true,
      members: { where: { status: "active" }, orderBy: { createdAt: "asc" }, take: 1, select: { userId: true } },
    },
  })
  const userId = workspace?.ownerUserId ?? workspace?.members[0]?.userId
  if (!userId) return "the workspace owner"

  const user = await db.user.findUnique({ where: { id: userId }, select: { personId: true, name: true } })
  if (user?.personId) {
    const person = await db.person.findUnique({ where: { id: user.personId }, select: { first: true, last: true } })
    const name = person ? `${person.first} ${person.last}`.trim() : ""
    if (name) return name
  }
  return user?.name?.trim() || "the workspace owner"
}

function buildSystemPrompt(ownerName: string, contacts: ContactRef[]): string {
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

  return `You are parsing communication history for a personal CRM belonging to ${ownerName}.

${ownerName} is the owner — do NOT create a person entry for them. They are the host/sender in every conversation. Every other participant is a contact.

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

export type AnalyzeContactHistoryInput = {
  workspaceId: string
  content: string
  filename?: string | null
  source?: string | null
}

export async function analyzeContactHistory(input: AnalyzeContactHistoryInput): Promise<ImportedPerson[]> {
  const ownerName = await resolveWorkspaceOwnerName(input.workspaceId)

  // Scoped to this workspace so Claude never sees, and a caller can never
  // "match" against, another tenant's contacts.
  const existingContacts = await db.person.findMany({
    where: { workspaceId: input.workspaceId },
    select: { id: true, first: true, last: true, title: true, headline: true, emails: true, phones: true },
  })

  const today = new Date().toISOString().split("T")[0]
  const sourceHint = input.source ? `\nSource system: ${input.source}` : ""

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: buildSystemPrompt(ownerName, existingContacts),
    messages: [{
      role: "user",
      content: `File: ${input.filename ?? "api-content"}${sourceHint}\nToday: ${today}\n\nContent:\n---\n${input.content.slice(0, 40000)}\n---`,
    }],
  })

  const text = message.content[0].type === "text" ? message.content[0].text : "[]"
  const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim()
  const parsed = JSON.parse(cleaned) as ImportedPerson[]

  // Claude can hallucinate ids — drop anything that doesn't resolve inside
  // this workspace's contact list rather than trusting it downstream.
  const validIds = new Set(existingContacts.map(c => c.id))
  for (const person of parsed) {
    if (person.matchedPersonId && !validIds.has(person.matchedPersonId)) {
      person.matchedPersonId = null
    }
    if (person.matchedPersonId) {
      const match = existingContacts.find(c => c.id === person.matchedPersonId)
      person.matchedPersonName = match ? `${match.first} ${match.last}` : null
      person.isNew = false
    }
  }

  return parsed
}
