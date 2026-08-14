import { db } from "@life-os/db"
import { registerReviewCommand, registerReviewDismiss } from "@life-os/domain"
import { updateFileMention } from "./mutations"

let registered = false

export function registerFileReviewHandlers() {
  if (registered) return
  registered = true

  registerReviewCommand("resolveFileEntityMention", async (input, context) => {
    const mentionId = String(input.mentionId ?? "")
    const personId = String(input.personId ?? input.suggestedPersonId ?? "")
    if (!mentionId || !personId) throw new Error("A mention and Person are required")
    const [mention, person] = await Promise.all([
      db.fileEntityMention.findFirst({ where: { id: mentionId, workspaceId: context.workspaceId } }),
      db.person.findFirst({ where: { id: personId, workspaceId: context.workspaceId }, select: { id: true } }),
    ])
    if (!mention || !person) throw new Error("Mention or Person not found")
    await updateFileMention({ mentionId: mention.id, workspaceId: context.workspaceId, action: "resolve", personId: person.id, actorId: context.actor?.id })
    return { resultType: "FileEntityMention", resultId: mention.id }
  })

  registerReviewCommand("reviewEvidenceClaim", async (input, context) => {
    const claimId = String(input.claimId ?? "")
    const claim = await db.evidenceClaim.findFirst({ where: { id: claimId, workspaceId: context.workspaceId } })
    if (!claim) throw new Error("Evidence claim not found")
    await db.evidenceClaim.update({ where: { id: claim.id }, data: { status: "accepted", reviewedAt: new Date(), reviewedBy: context.actor?.id ?? null } })
    return { resultType: "EvidenceClaim", resultId: claim.id }
  })

  registerReviewDismiss("file_entity_mention", async (sourceId, context) => {
    await updateFileMention({ mentionId: sourceId, workspaceId: context.workspaceId, action: "not_this_person", actorId: context.actor?.id })
  })
  registerReviewDismiss("evidence_claim", async (sourceId, context) => {
    await db.evidenceClaim.updateMany({ where: { id: sourceId, workspaceId: context.workspaceId }, data: { status: "dismissed", reviewedAt: new Date(), reviewedBy: context.actor?.id ?? null } })
  })
}
