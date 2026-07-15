import { getRelationshipGaps } from "./relationships"
import { getStalledPlanSignals } from "./plans"
import type { AlignmentSignal } from "./types"

export async function getAlignmentSignals(workspaceId: string): Promise<AlignmentSignal[]> {
  const [relationshipGaps, stalledPlans] = await Promise.all([
    getRelationshipGaps(workspaceId),
    getStalledPlanSignals(workspaceId),
  ])
  return [...relationshipGaps, ...stalledPlans].sort((a, b) => b.severity - a.severity)
}
