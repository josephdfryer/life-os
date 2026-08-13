import { getRelationshipGaps } from "./relationships"
import { getStalledPlanSignals } from "./plans"
import { getBirthdaySignals } from "./birthday-signals"
import type { AlignmentSignal } from "./types"

export async function getAlignmentSignals(workspaceId: string, tz?: string): Promise<AlignmentSignal[]> {
  const [relationshipGaps, stalledPlans, birthdays] = await Promise.all([
    getRelationshipGaps(workspaceId),
    getStalledPlanSignals(workspaceId),
    getBirthdaySignals(workspaceId, tz),
  ])
  return [...relationshipGaps, ...stalledPlans, ...birthdays].sort((a, b) => b.severity - a.severity)
}
