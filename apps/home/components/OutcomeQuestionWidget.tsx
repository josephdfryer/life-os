import { matchPassiveOutcomes, getPendingOutcomeQuestion } from "@life-os/intelligence"
import OutcomeQuestionCard from "./OutcomeQuestionCard"

// Runs the passive-match sweep (idempotent — only writes an outcome for an
// intervention that doesn't have one yet) and, if nothing resolved it,
// offers the single oldest unresolved one as Evening Check-In's one
// allowed intervention question. See docs/ADAPTIVE_DAY_PLAN.md §5.
export default async function OutcomeQuestionWidget({ workspaceId, tz }: { workspaceId: string; tz: string }) {
  await matchPassiveOutcomes(workspaceId, tz, { type: "system", workspaceId })
  const pending = await getPendingOutcomeQuestion(workspaceId, tz)
  if (!pending) return null
  return <OutcomeQuestionCard intervention={pending} />
}
