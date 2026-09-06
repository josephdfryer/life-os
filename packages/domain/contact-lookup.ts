// Index-backed contact matching. The scorer in ./contact-matching is
// unchanged; what changes is how candidates reach it. Instead of loading every
// Person in the workspace and matching in memory (O(people) per record — the
// worst scaling bug in the 2026-09-06 review), candidates come from two
// bounded queries:
//
//   1. exact identifier keys via PersonContact, a trigger-maintained index of
//      normalized emails and phones (migration 20260906080000);
//   2. fuzzy names via pg_trgm similarity, computed in the database and
//      capped, so a typo like "Grase Hoper" still finds "Grace Hopper".
//
// The union of those candidates is then scored by findMatch exactly as
// before, so thresholds, reasons, and fillable fields are identical.

import {
  emailKeys,
  findMatch,
  normalizeMatchText,
  phoneKeys,
  type MatchResult,
  type MatchableContact,
  type MatchableExistingPerson,
} from "./contact-matching"

const FUZZY_CANDIDATES_PER_CONTACT = 40
// pg_trgm similarity floor for retrieval. Deliberately looser than any scoring
// threshold: retrieval only has to not lose a candidate the scorer would have
// accepted; the scorer still decides.
const FUZZY_SIMILARITY_FLOOR = 0.3

const matchableSelect = {
  id: true, first: true, last: true, company: true, title: true, headline: true,
  birthday: true, location: true, linkedin: true, twitter: true, website: true,
  facebook: true, instagram: true, notes: true, emails: true, phones: true,
} as const

type MatchableRow = Omit<MatchableExistingPerson, "emails" | "phones"> & { emails: string; phones: string }

function parseList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
}

function toMatchable(row: MatchableRow): MatchableExistingPerson {
  return { ...row, emails: parseList(row.emails), phones: parseList(row.phones) }
}

function contactName(contact: MatchableContact) {
  return normalizeMatchText(`${contact.first ?? ""} ${contact.last ?? ""}`)
}

/**
 * Match one incoming contact against the workspace. Same result shape and
 * scoring as findMatch over all people; only candidate retrieval differs.
 */
export async function matchContact(contact: MatchableContact, workspaceId: string): Promise<MatchResult | null> {
  const [result] = await matchContacts([contact], workspaceId)
  return result ?? null
}

/**
 * Batch form for imports and syncs: one key lookup and one fuzzy query per
 * distinct name cover every contact in the batch.
 */
export async function matchContacts(contacts: MatchableContact[], workspaceId: string): Promise<(MatchResult | null)[]> {
  if (contacts.length === 0) return []
  const { db } = await import("@life-os/db")

  const emails = new Set<string>()
  const phones = new Set<string>()
  const names = new Set<string>()
  for (const contact of contacts) {
    for (const key of emailKeys([...(contact.emails ?? []), contact.email])) emails.add(key)
    for (const key of phoneKeys([...(contact.phones ?? []), contact.phone])) phones.add(key)
    const name = contactName(contact)
    if (name) names.add(name)
  }

  const candidateIds = new Set<string>()
  if (emails.size || phones.size) {
    const keyRows = await db.personContact.findMany({
      where: {
        workspaceId,
        OR: [
          ...(emails.size ? [{ kind: "email", normalized: { in: [...emails] } }] : []),
          ...(phones.size ? [{ kind: "phone", normalized: { in: [...phones] } }] : []),
        ],
      },
      select: { personId: true },
    })
    for (const row of keyRows) candidateIds.add(row.personId)
  }
  for (const name of names) {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT p."id"
      FROM "Person" p
      WHERE p."workspaceId" = ${workspaceId}
        AND similarity(lower(p."first" || ' ' || p."last"), ${name}) > ${FUZZY_SIMILARITY_FLOOR}
      ORDER BY similarity(lower(p."first" || ' ' || p."last"), ${name}) DESC
      LIMIT ${FUZZY_CANDIDATES_PER_CONTACT}`
    for (const row of rows) candidateIds.add(row.id)
  }
  if (candidateIds.size === 0) return contacts.map(() => null)

  const rows = await db.person.findMany({
    where: { workspaceId, id: { in: [...candidateIds] } },
    select: matchableSelect,
  })
  const candidates = rows.map(row => toMatchable(row as MatchableRow))
  return contacts.map(contact => findMatch(contact, candidates))
}

/**
 * People keyed by normalized email, for syncs that resolve message parties
 * (Gmail, calendar). Reads the key index joined to the name, never the full
 * Person row, and only for the emails asked about.
 */
export async function peopleByEmailKeys(
  emails: Iterable<string | null | undefined>,
  workspaceId: string,
): Promise<Map<string, { id: string; first: string; last: string }>> {
  const keys = [...emailKeys([...emails])]
  const byEmail = new Map<string, { id: string; first: string; last: string }>()
  if (keys.length === 0) return byEmail
  const { db } = await import("@life-os/db")
  const rows = await db.personContact.findMany({
    where: { workspaceId, kind: "email", normalized: { in: keys } },
    select: { normalized: true, person: { select: { id: true, first: true, last: true } } },
  })
  for (const row of rows) if (!byEmail.has(row.normalized)) byEmail.set(row.normalized, row.person)
  return byEmail
}

/**
 * Every email key in the workspace with the person it belongs to. Bounded and
 * narrow (no Person row, no JSON parsing); for syncs that walk an unknown
 * set of messages and prefer one lookup up front to one per batch.
 */
export async function workspaceEmailIndex(
  workspaceId: string,
  limit = 50_000,
): Promise<Map<string, { id: string; first: string; last: string }>> {
  const { db } = await import("@life-os/db")
  const rows = await db.personContact.findMany({
    where: { workspaceId, kind: "email" },
    select: { normalized: true, person: { select: { id: true, first: true, last: true } } },
    take: limit,
  })
  const byEmail = new Map<string, { id: string; first: string; last: string }>()
  for (const row of rows) if (!byEmail.has(row.normalized)) byEmail.set(row.normalized, row.person)
  return byEmail
}
