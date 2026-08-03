import { CaptureValidationError, normalizeCaptureInput } from "./capture"

export type CaptureActionInput = {
  workspaceId: string
  content: string
  source: string
  timestamp?: Date
  idempotencyKey?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Captures an action without pretending it is already a commitment. The Note
 * preserves Joseph's exact words; the draft Plan makes the candidate available
 * to Home's Action Inbox. Both records are written atomically and share one
 * retry-safe key.
 */
export async function captureAction(input: CaptureActionInput) {
  const { db } = await import("@life-os/db")
  const value = normalizeCaptureInput({ ...input, type: "declaration" })
  const noteId = value.idempotencyKey ? `action_note_${value.idempotencyKey}` : undefined
  const planId = value.idempotencyKey ? `action_plan_${value.idempotencyKey}` : undefined

  if (noteId && planId) {
    const [existingNote, existingPlan] = await Promise.all([
      db.note.findUnique({
        where: { id: noteId },
        select: { id: true, workspaceId: true, timestamp: true, type: true, content: true },
      }),
      db.plan.findUnique({
        where: { id: planId },
        select: { id: true, workspaceId: true, text: true, status: true, sourceNoteId: true },
      }),
    ])
    if (existingNote || existingPlan) {
      if (
        !existingNote || !existingPlan
        || existingNote.workspaceId !== value.workspaceId
        || existingPlan.workspaceId !== value.workspaceId
        || existingPlan.sourceNoteId !== existingNote.id
      ) {
        throw new CaptureValidationError("idempotencyKey belongs to another or incomplete capture")
      }
      return { note: existingNote, plan: existingPlan, created: false }
    }
  }

  const metadata = JSON.stringify({
    ...(input.metadata ?? {}),
    source: value.source,
    capture: {
      version: 1,
      kind: "action",
      idempotencyKey: value.idempotencyKey,
    },
  })

  try {
    const result = await db.$transaction(async tx => {
      const note = await tx.note.create({
        data: {
          ...(noteId ? { id: noteId } : {}),
          workspaceId: value.workspaceId,
          timestamp: value.timestamp,
          type: "declaration",
          content: value.content,
          metadata,
        },
        select: { id: true, workspaceId: true, timestamp: true, type: true, content: true },
      })
      const plan = await tx.plan.create({
        data: {
          ...(planId ? { id: planId } : {}),
          workspaceId: value.workspaceId,
          text: value.content,
          status: "draft",
          sourceNoteId: note.id,
        },
        select: { id: true, workspaceId: true, text: true, status: true, sourceNoteId: true },
      })
      return { note, plan }
    })
    return { ...result, created: true }
  } catch (error) {
    if (!noteId || !planId || !isUniqueConstraintError(error)) throw error
    const [note, plan] = await Promise.all([
      db.note.findUnique({
        where: { id: noteId },
        select: { id: true, workspaceId: true, timestamp: true, type: true, content: true },
      }),
      db.plan.findUnique({
        where: { id: planId },
        select: { id: true, workspaceId: true, text: true, status: true, sourceNoteId: true },
      }),
    ])
    if (!note || !plan || note.workspaceId !== value.workspaceId || plan.workspaceId !== value.workspaceId) {
      throw error
    }
    return { note, plan, created: false }
  }
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002")
}
