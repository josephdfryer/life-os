import { registerReviewCommand, type ReviewItemActorContext, type ReviewItemCommandResult } from "./review"
import { createPerson, updatePerson, type PersonInput } from "./persons"

// Registered so a staged device-Contacts sync (apps/api/lib/device-ingest.ts,
// "contact.person" records that didn't clear the auto-apply bar) can be
// accepted or edited-and-accepted from the generic Inbox, the same way
// staged_interaction.accept/import_staged_visit.review already work. There is
// no separate legacy staging table for contacts (unlike StagedInteraction/
// ImportStagedVisit) — the ReviewItem row is the only record of the
// proposal, so this command carries the full proposed Person fields in its
// input rather than just a foreign id.
registerReviewCommand("contact.import", async (input, ctx: ReviewItemActorContext): Promise<ReviewItemCommandResult> => {
  const matchedPersonId = typeof input.matchedPersonId === "string" ? input.matchedPersonId : null
  if (matchedPersonId) {
    const updated = await updatePerson(matchedPersonId, input as PersonInput, ctx.workspaceId, ctx.actor)
    return { resultType: "Person", resultId: updated.id }
  }
  const created = await createPerson({ ...(input as PersonInput), source: "ios_contacts" }, ctx.workspaceId, ctx.actor)
  return { resultType: "Person", resultId: created.id }
})
