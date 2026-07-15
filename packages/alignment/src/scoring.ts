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

export function daysSince(date: Date | null): number {
  if (!date) return 9999
  return Math.floor((Date.now() - date.getTime()) / 86400000)
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
  const threshold = CLOSENESS_THRESHOLD_DAYS[closeness] ?? 21
  return daysSince(lastInteractionAt) / threshold
}
