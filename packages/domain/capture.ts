export const CAPTURE_NOTE_TYPES = [
  "thought",
  "observation",
  "declaration",
  "voice_transcript",
  "import",
  "theory_observation",
] as const

export type CaptureNoteType = typeof CAPTURE_NOTE_TYPES[number]

export class CaptureValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CaptureValidationError"
  }
}

export type CaptureNoteInput = {
  workspaceId: string
  content: string
  type?: string | null
  source: string
  timestamp?: Date
  idempotencyKey?: string | null
  metadata?: Record<string, unknown> | null
}

export function normalizeCaptureInput(input: CaptureNoteInput) {
  const workspaceId = input.workspaceId.trim()
  const content = input.content.trim()
  const source = input.source.trim()
  if (!workspaceId) throw new CaptureValidationError("workspaceId is required")
  if (!content) throw new CaptureValidationError("content is required")
  if (content.length > 10_000) throw new CaptureValidationError("content must be 10,000 characters or fewer")
  if (!source) throw new CaptureValidationError("source is required")

  const type = CAPTURE_NOTE_TYPES.includes(input.type as CaptureNoteType)
    ? input.type as CaptureNoteType
    : "thought"
  const timestamp = input.timestamp ?? new Date()
  if (Number.isNaN(timestamp.getTime())) throw new CaptureValidationError("timestamp is invalid")

  const idempotencyKey = input.idempotencyKey?.trim() || null
  if (idempotencyKey && !/^[a-zA-Z0-9_-]{8,120}$/.test(idempotencyKey)) {
    throw new CaptureValidationError("idempotencyKey is invalid")
  }

  return { workspaceId, content, source, type, timestamp, idempotencyKey }
}

export async function captureNote(input: CaptureNoteInput) {
  const { db } = await import("@life-os/db")
  const value = normalizeCaptureInput(input)
  const id = value.idempotencyKey ? `capture_${value.idempotencyKey}` : undefined
  const metadata = JSON.stringify({
    ...(input.metadata ?? {}),
    source: value.source,
    capture: {
      version: 1,
      idempotencyKey: value.idempotencyKey,
    },
  })

  if (id) {
    const existing = await db.note.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, timestamp: true, type: true, content: true, metadata: true },
    })
    if (existing) {
      if (existing.workspaceId !== value.workspaceId) {
        throw new CaptureValidationError("idempotencyKey belongs to another workspace")
      }
      return { note: existing, created: false }
    }
  }

  try {
    const note = await db.note.create({
      data: {
        ...(id ? { id } : {}),
        workspaceId: value.workspaceId,
        timestamp: value.timestamp,
        type: value.type,
        content: value.content,
        metadata,
      },
      select: { id: true, workspaceId: true, timestamp: true, type: true, content: true, metadata: true },
    })
    return { note, created: true }
  } catch (error) {
    if (!id || !error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error
    const existing = await db.note.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, timestamp: true, type: true, content: true, metadata: true },
    })
    if (!existing || existing.workspaceId !== value.workspaceId) throw error
    return { note: existing, created: false }
  }
}
