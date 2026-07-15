import type { Person, Interaction, Plan, PersonWithAttention } from "@/types"
import { relationshipGapScore, daysSince } from "@life-os/alignment/pure"

export { daysSince }

export function lastInteractionDate(interactions: Interaction[]): Date | null {
  if (!interactions.length) return null
  const sorted = [...interactions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
  return new Date(sorted[0].timestamp)
}

// Delegates to @life-os/alignment so Persons, Home, and the assistant share
// one definition of "overdue" instead of quietly drifting apart.
export function attentionScore(
  person: Person,
  interactions: Interaction[],
  plans: Plan[] = []
): number {
  return relationshipGapScore({
    closeness: person.closeness,
    lastInteractionAt: lastInteractionDate(interactions),
    hasActivePlan: plans.some(p => p.status === "active"),
  })
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
