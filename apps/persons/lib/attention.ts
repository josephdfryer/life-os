import type { Person, Interaction, Plan, PersonWithAttention } from "@/types"

// Acquaintance has no threshold — only surfaces if they have an active plan
const THRESHOLDS: Record<number, number> = {
  2: 21,  // Friend
  3: 10,  // Inner Circle
}

// Threshold used for an Acquaintance who has at least one active plan
const ACQUAINTANCE_WITH_PLAN_THRESHOLD = 30

export function lastInteractionDate(interactions: Interaction[]): Date | null {
  if (!interactions.length) return null
  const sorted = [...interactions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
  return new Date(sorted[0].timestamp)
}

export function daysSince(date: Date | null): number {
  if (!date) return 9999
  const now = new Date()
  const diff = now.getTime() - new Date(date).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

export function attentionScore(
  person: Person,
  interactions: Interaction[],
  plans: Plan[] = []
): number {
  if (person.closeness === 1) {
    const hasActivePlan = plans.some(p => p.status === "active")
    if (!hasActivePlan) return 0
    const last = lastInteractionDate(interactions)
    const days = daysSince(last)
    return days / ACQUAINTANCE_WITH_PLAN_THRESHOLD
  }

  const last = lastInteractionDate(interactions)
  const days = daysSince(last)
  const threshold = THRESHOLDS[person.closeness] ?? 21
  return days / threshold
}

export function enrichWithAttention(
  person: Person & { interactions: Interaction[]; plans?: Plan[] }
): PersonWithAttention {
  const last = lastInteractionDate(person.interactions)
  const days = daysSince(last)
  const score = attentionScore(person, person.interactions, person.plans ?? [])
  return {
    ...person,
    attentionScore: score,
    lastInteractionDate: last,
    daysSinceLast: last ? days : null,
  }
}
