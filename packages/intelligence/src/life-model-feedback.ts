import { publishGraphEvent } from "@life-os/domain"
import { LifeModelError } from "./life-model"
import type { LifeModelFeedbackAction, LifeModelFeedbackActor } from "./types"

export type RecordLifeModelClaimFeedbackInput = {
  workspaceId: string
  claimId: string
  action: LifeModelFeedbackAction
  replacementStatement?: string | null
  reason?: string | null
  actor: LifeModelFeedbackActor
}

export async function recordLifeModelClaimFeedback(input: RecordLifeModelClaimFeedbackInput) {
  const replacementStatement = input.action === "correct" ? clean(input.replacementStatement, 4_000) : null
  const reason = clean(input.reason, 2_000)
  if (input.action === "correct" && !replacementStatement) {
    throw new LifeModelError("A corrected statement is required.", "validation")
  }

  const { db } = await import("@life-os/db")
  const claim = await db.lifeModelClaim.findFirst({
    where: { id: input.claimId, snapshot: { workspaceId: input.workspaceId } },
    select: { id: true, statement: true, kind: true, subjectType: true, subjectId: true },
  })
  if (!claim) throw new LifeModelError("Life-model claim not found.", "not_found")

  return db.$transaction(async tx => {
    const sourceNote = input.action === "correct"
      ? await tx.note.create({
          data: {
            workspaceId: input.workspaceId,
            timestamp: new Date(),
            type: "intelligence_correction",
            content: replacementStatement!,
            metadata: JSON.stringify({
              source: "life_model_feedback",
              claimId: claim.id,
              originalStatement: claim.statement,
              claimKind: claim.kind,
              reason,
            }),
          },
          select: { id: true },
        })
      : null

    const feedback = await tx.lifeModelClaimFeedback.create({
      data: {
        workspaceId: input.workspaceId,
        claimId: claim.id,
        action: input.action,
        replacementStatement,
        reason,
        sourceNoteId: sourceNote?.id ?? null,
        actorType: input.actor.type,
        actorId: input.actor.id ?? null,
        actorLabel: input.actor.label ?? null,
      },
    })

    await publishGraphEvent(tx, {
      workspaceId: input.workspaceId,
      subjectType: "LifeModelClaim",
      subjectId: claim.id,
      eventType: `intelligence.claim.${input.action === "correct" ? "corrected" : "dismissed"}`,
      actor: input.actor,
      idempotencyKey: `life-model-feedback:${feedback.id}`,
      payload: {
        feedbackId: feedback.id,
        action: input.action,
        replacementStatement,
        reason,
        sourceNoteId: sourceNote?.id ?? null,
        subjectType: claim.subjectType,
        subjectId: claim.subjectId,
      },
      provenance: sourceNote ? { noteId: sourceNote.id } : null,
    })

    return feedback
  })
}

function clean(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}
