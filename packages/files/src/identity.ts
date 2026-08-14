import { db, normalizePhoneDigits } from "@life-os/db"
import type { ProposedMention } from "./types"

type Resolution = {
  status: "resolved" | "suggested" | "unresolved"
  level: number
  personId?: string
  reason: string
  confidence: number
}

function values(raw: string) {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch { return [] }
}

export async function resolvePersonMention(mention: ProposedMention, workspaceId: string): Promise<Resolution> {
  const people = await db.person.findMany({
    where: { workspaceId },
    select: { id: true, first: true, last: true, nickname: true, emails: true, phones: true, company: true, location: true, groupMemberships: { select: { group: { select: { name: true } } } } },
  })

  if (mention.email) {
    const email = mention.email.trim().toLowerCase()
    const matches = people.filter(person => values(person.emails).some(value => value.trim().toLowerCase() === email))
    if (matches.length === 1) return { status: "resolved", level: 1, personId: matches[0].id, reason: "exact email", confidence: 1 }
  }
  if (mention.phone) {
    const phone = normalizePhoneDigits(mention.phone)
    const matches = people.filter(person => values(person.phones).some(value => normalizePhoneDigits(value) === phone))
    if (phone && matches.length === 1) return { status: "resolved", level: 1, personId: matches[0].id, reason: "exact phone", confidence: 1 }
  }
  if (mention.externalId) {
    const match = await db.personExternalIdentifier.findUnique({
      where: { workspaceId_externalId: { workspaceId, externalId: mention.externalId.trim() } },
      select: { personId: true },
    })
    if (match) return { status: "resolved", level: 2, personId: match.personId, reason: "exact external identifier", confidence: 0.98 }
  }

  const normalized = normalizeName(mention.sourceText)
  const nameMatches = people.filter(person => {
    const full = normalizeName(`${person.first} ${person.last}`)
    const nick = normalizeName(`${person.nickname ?? ""} ${person.last}`)
    return normalized === full || (!!person.nickname && normalized === nick)
  })
  if (nameMatches.length !== 1) {
    return { status: "unresolved", level: 5, reason: nameMatches.length > 1 ? "ambiguous full name" : "no unique identity evidence", confidence: 0 }
  }

  const candidate = nameMatches[0]
  const corroborated = [
    mention.employer && candidate.company && normalizeText(mention.employer) === normalizeText(candidate.company),
    mention.address && candidate.location && normalizeText(candidate.location).includes(normalizeText(mention.address)),
    mention.group && candidate.groupMemberships.some(membership => normalizeText(membership.group.name) === normalizeText(mention.group!)),
  ].some(Boolean)
  if (corroborated) return { status: "resolved", level: 3, personId: candidate.id, reason: "unique full name with corroboration", confidence: 0.9 }
  return { status: "suggested", level: 4, personId: candidate.id, reason: "unique full name only", confidence: 0.65 }
}

export function normalizeName(value: string) {
  return normalizeText(value).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()
}

function normalizeText(value: string) { return value.normalize("NFKC").toLowerCase().trim() }
