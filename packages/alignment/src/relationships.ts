// Relationship gap detection — compares declared closeness against actual
// contact cadence. This is the single definition of "overdue" shared by
// Persons (Today page, Person detail), Home (nudges), and the assistant, so
// none of them can quietly disagree with each other.
//
// DB-touching — do not import from a client component. Client-side callers
// (e.g. Persons' attention.ts) should import the pure formula from ./scoring
// instead.

import type { AlignmentSignal } from "./types"
import { relationshipGapScore, daysSince } from "./scoring"

// Person.source values that mean "arrived in a bulk contact sweep", not
// "someone deliberately put this person in the graph". A record from one of
// these that has never had a single recorded interaction and has no plan
// naming it is an unreviewed address-book row — a business, a one-off, a
// duplicate — and nudging about it is noise, not a relationship.
// "manual" / "api" / "system" / "rule" are excluded on purpose: those were
// created intentionally. So is null, which only means the row predates the
// column — those are the oldest records in the graph and the most likely to
// be real, so they are never suppressed on a guess.
const BULK_IMPORT_SOURCES = new Set([
  "vcard",
  "csv",
  "spreadsheet",
  "gmail_contacts",
  "ios_contacts",
  "interaction_import",
])

export async function getRelationshipGaps(workspaceId: string): Promise<AlignmentSignal[]> {
  const { db } = await import("@life-os/db")
  const persons = await db.person.findMany({
    where: {
      workspaceId,
      // Exclude the self Person (tagged "self") — a relationship-gap signal
      // about not having contacted yourself is nonsensical.
      NOT: { tags: { contains: '"self"' } },
      OR: [{ closeness: { gte: 2 } }, { plans: { some: { status: "active" } } }],
    },
    select: {
      id: true,
      first: true,
      last: true,
      closeness: true,
      source: true,
      interactions: { orderBy: { timestamp: "desc" }, take: 1, select: { timestamp: true, summary: true } },
      plans: { where: { status: "active" }, select: { id: true }, take: 1 },
    },
    // The WHERE clause already restricts this to close/plan-linked people —
    // a small, bounded set for any real workspace — but Home's Intelligence
    // page now calls this on every request, not just from a background job,
    // so an explicit cap protects against that changing quietly as the
    // graph grows.
    take: 1_000,
  })

  const signals: AlignmentSignal[] = []
  for (const p of persons) {
    const lastAt = p.interactions[0]?.timestamp ?? null
    const hasActivePlan = p.plans.length > 0
    // Curation, not scoring: an unreviewed bulk-imported row with no history
    // and no plan is noise. Anything with a real interaction behind it, an
    // active plan, or a deliberate origin still scores normally below.
    if (!lastAt && !hasActivePlan && BULK_IMPORT_SOURCES.has(p.source ?? "")) continue
    const score = relationshipGapScore({
      closeness: p.closeness,
      lastInteractionAt: lastAt,
      hasActivePlan,
    })
    if (score < 1.0) continue
    signals.push({
      kind: "relationship_gap",
      severity: score,
      subject: `${p.first} ${p.last}`,
      detail: lastAt ? `No recorded contact in ${daysSince(lastAt)} days` : "No recorded contact yet",
      evidenceSummary: p.interactions[0]?.summary ?? null,
      personId: p.id,
    })
  }
  return signals.sort((a, b) => b.severity - a.severity)
}
