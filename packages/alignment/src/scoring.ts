// Pure relationship-gap scoring — no I/O, no imports. Deliberately isolated
// from anything that touches @life-os/db so it can be safely imported by
// client components (e.g. Persons' PersonDetailClient) without pulling
// server-only/native modules into the browser bundle.

// Acquaintance (1) has no ambient threshold — it only surfaces if there is an
// active Plan naming an expectation. Nurture (2) through Inner Circle (4)
// scale down as declared closeness increases.
const CLOSENESS_THRESHOLD_DAYS: Record<number, number> = {
  2: 90,
  3: 21,
  4: 10,
}
const ACQUAINTANCE_WITH_PLAN_THRESHOLD_DAYS = 30

const BULK_IMPORT_SOURCES = new Set([
  "vcard",
  "csv",
  "spreadsheet",
  "gmail_contacts",
  "ios_contacts",
  "interaction_import",
])

// Curation shared by every server-rendered attention surface. An untouched
// bulk-import row is an address-book fact, not evidence that the owner wants
// a recurring relationship cadence. Deliberate origins, real history, and an
// active Plan all opt the Person back into normal gap scoring.
export function isUnreviewedBulkContact(input: {
  source: string | null | undefined
  lastInteractionAt: Date | null
  hasActivePlan: boolean
}): boolean {
  return !input.lastInteractionAt
    && !input.hasActivePlan
    && BULK_IMPORT_SOURCES.has(input.source ?? "")
}

export function daysSince(date: Date | null, now = new Date()): number {
  if (!date) return 9999
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000))
}

// >= 1.0 means overdue relative to threshold.
export function relationshipGapScore(input: {
  closeness: number
  lastInteractionAt: Date | null
  hasActivePlan: boolean
}): number {
  const { closeness, lastInteractionAt, hasActivePlan } = input
  if (closeness === 1) {
    if (!hasActivePlan) return 0
    return daysSince(lastInteractionAt) / ACQUAINTANCE_WITH_PLAN_THRESHOLD_DAYS
  }
  // Deliberately no "hide people with no recorded contact" rule here. This
  // function answers one question — how overdue is this relationship against
  // its declared cadence — and every surface shares it. Whether a given
  // person is worth surfacing at all is curation, and it belongs to the
  // caller that has the provenance to judge it (see getRelationshipGaps).
  // Encoding it here silently emptied Persons' Today page, which passes
  // plans: [] and so could never hit the active-plan escape hatch.
  const threshold = CLOSENESS_THRESHOLD_DAYS[closeness] ?? 21
  return daysSince(lastInteractionAt) / threshold
}
