import Anthropic from "@anthropic-ai/sdk"
import { db } from "@/lib/db"
import type { StageRecordInput } from "./inbox"

let client: Anthropic | null = null
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[inbox-enrich] ANTHROPIC_API_KEY not set — enrichment disabled")
    return null
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}

export type EnrichResult = {
  candidatePersonId: string | null
  confidence: number
  matchReason: string
  summary: string | null
  priority: number
}

type PersonCandidate = {
  id: string
  first: string
  last: string
  emails: string
  phones: string
  closeness: number | null
}

type HaikuResponse = {
  personId: string | null
  confidence: number
  reason: string
  summary: string | null
  priority: number
}

export async function enrichInboxItem(
  stagedId: string,
  input: StageRecordInput,
  workspaceId: string,
): Promise<EnrichResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  try {
    const candidates = await queryCandidates(input, workspaceId)
    const raw = await callHaiku(input, candidates)
    if (!raw) return null

    const validPersonId =
      raw.personId && candidates.some(c => c.id === raw.personId) ? raw.personId : null

    const result: EnrichResult = {
      candidatePersonId: validPersonId,
      confidence: Math.max(0, Math.min(100, raw.confidence ?? 0)),
      matchReason: raw.reason ?? "",
      summary: raw.summary ?? null,
      priority: Math.max(1, Math.min(5, raw.priority ?? 3)),
    }

    await db.stagedInteraction.update({
      where: { id: stagedId },
      data: {
        candidatePersonId: result.candidatePersonId,
        confidence: result.confidence,
        matchReason: result.matchReason,
        ...(result.summary ? { summary: result.summary } : {}),
        priority: result.priority,
        enrichedAt: new Date(),
      },
    })

    return result
  } catch {
    return null
  }
}

async function queryCandidates(
  input: StageRecordInput,
  workspaceId: string,
): Promise<PersonCandidate[]> {
  const seen = new Set<string>()
  const results: PersonCandidate[] = []

  const emailMatches = input.contactEmail
    ? await db.person.findMany({
        where: { workspaceId, emails: { contains: input.contactEmail } },
        select: { id: true, first: true, last: true, emails: true, phones: true, closeness: true },
        take: 5,
      })
    : []

  const phoneMatches = input.contactPhone
    ? await db.person.findMany({
        where: { workspaceId, phones: { contains: input.contactPhone } },
        select: { id: true, first: true, last: true, emails: true, phones: true, closeness: true },
        take: 5,
      })
    : []

  for (const p of [...emailMatches, ...phoneMatches]) {
    if (!seen.has(p.id)) {
      seen.add(p.id)
      results.push(p)
    }
  }

  const topByCloseness = await db.person.findMany({
    where: { workspaceId },
    select: { id: true, first: true, last: true, emails: true, phones: true, closeness: true },
    orderBy: { closeness: "desc" },
    take: 10,
  })

  for (const p of topByCloseness) {
    if (!seen.has(p.id)) {
      seen.add(p.id)
      results.push(p)
    }
    if (results.length >= 10) break
  }

  return results
}

async function callHaiku(
  input: StageRecordInput,
  candidates: PersonCandidate[],
): Promise<HaikuResponse | null> {
  const candidateList = candidates.length
    ? candidates
        .map(c => {
          const emails = safeJsonArray(c.emails)
          const phones = safeJsonArray(c.phones)
          const parts = [`id="${c.id}"`, `name="${c.first} ${c.last}"`]
          if (emails[0]) parts.push(`email="${emails[0]}"`)
          if (phones[0]) parts.push(`phone="${phones[0]}"`)
          if (c.closeness) parts.push(`closeness=${c.closeness}`)
          return `  - ${parts.join(" ")}`
        })
        .join("\n")
    : "  (none)"

  const prompt = `You are enriching an inbox item for a personal CRM. Return a single JSON object — no markdown, no explanation.

Inbox item:
  source: ${input.source}
  contact_name: ${input.contactName ?? "(unknown)"}
  contact_email: ${input.contactEmail ?? "(none)"}
  contact_phone: ${input.contactPhone ?? "(none)"}
  body_preview: ${(input.body ?? "").slice(0, 400)}

Known persons:
${candidateList}

Required JSON:
{
  "personId": "<id from known persons, or null if no match>",
  "confidence": <0-100, where 95+=email/phone exact match, 80+=name+context match, 50-79=partial match, <50=no good match>,
  "reason": "<one sentence explaining the match or non-match>",
  "summary": "<1-2 sentence summary of the interaction content, or null if the body is trivial/empty>",
  "priority": <1-5, where 5=urgent question or commitment with deadline, 4=substantive exchange with known contact, 3=normal conversation, 2=fyi/informational, 1=automated or one-liner>
}`

  const c = getClient()
  if (!c) return null
  const response = await c.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  })

  const text = response.content[0].type === "text" ? response.content[0].text : ""
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1) return null

  try {
    return JSON.parse(text.slice(start, end + 1)) as HaikuResponse
  } catch {
    return null
  }
}

function safeJsonArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
