export const CAPTURE_NOTE_TYPES = [
  "thought",
  "observation",
  "declaration",
  "voice_transcript",
  "import",
  "theory_observation",
] as const

export type CaptureNoteType = typeof CAPTURE_NOTE_TYPES[number]

export const NOTE_SUBJECT_FIELDS = [
  "aboutPersonId",
  "aboutPlaceId",
  "aboutItemId",
  "aboutEventId",
  "aboutPlanId",
  "aboutGroupId",
  "aboutStateId",
] as const

export type NoteSubjectField = typeof NOTE_SUBJECT_FIELDS[number]

export type NoteSubject = {
  aboutPersonId?: string | null
  aboutPlaceId?: string | null
  aboutItemId?: string | null
  aboutEventId?: string | null
  aboutPlanId?: string | null
  aboutGroupId?: string | null
  aboutStateId?: string | null
}

export class CaptureValidationError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation" = "validation") {
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
} & NoteSubject

const NOTE_SELECT = {
  id: true,
  workspaceId: true,
  createdAt: true,
  timestamp: true,
  type: true,
  content: true,
  metadata: true,
  sourceFileId: true,
  aboutPersonId: true,
  aboutPlaceId: true,
  aboutItemId: true,
  aboutEventId: true,
  aboutPlanId: true,
  aboutGroupId: true,
  aboutStateId: true,
} as const

function optionalId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || null
  return trimmed
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

  return {
    workspaceId,
    content,
    source,
    type,
    timestamp,
    idempotencyKey,
    aboutPersonId: optionalId(input.aboutPersonId),
    aboutPlaceId: optionalId(input.aboutPlaceId),
    aboutItemId: optionalId(input.aboutItemId),
    aboutEventId: optionalId(input.aboutEventId),
    aboutPlanId: optionalId(input.aboutPlanId),
    aboutGroupId: optionalId(input.aboutGroupId),
    aboutStateId: optionalId(input.aboutStateId),
  }
}

async function resolveSubjects(
  db: Awaited<typeof import("@life-os/db")>["db"],
  workspaceId: string,
  subjects: NoteSubject,
) {
  const checks: Array<{ id: string | null | undefined; label: string; find: () => Promise<{ id: string } | null> }> = [
    { id: subjects.aboutPersonId, label: "Person", find: () => db.person.findFirst({ where: { id: subjects.aboutPersonId!, workspaceId }, select: { id: true } }) },
    { id: subjects.aboutPlaceId, label: "Place", find: () => db.place.findFirst({ where: { id: subjects.aboutPlaceId!, workspaceId }, select: { id: true } }) },
    { id: subjects.aboutItemId, label: "Item", find: () => db.item.findFirst({ where: { id: subjects.aboutItemId!, workspaceId }, select: { id: true } }) },
    { id: subjects.aboutEventId, label: "Event", find: () => db.event.findFirst({ where: { id: subjects.aboutEventId!, workspaceId }, select: { id: true } }) },
    { id: subjects.aboutPlanId, label: "Plan", find: () => db.plan.findFirst({ where: { id: subjects.aboutPlanId!, workspaceId }, select: { id: true } }) },
    { id: subjects.aboutGroupId, label: "Group", find: () => db.group.findFirst({ where: { id: subjects.aboutGroupId!, workspaceId }, select: { id: true } }) },
    { id: subjects.aboutStateId, label: "State", find: () => db.state.findFirst({ where: { id: subjects.aboutStateId!, workspaceId }, select: { id: true } }) },
  ]

  for (const check of checks) {
    if (!check.id) continue
    const found = await check.find()
    if (!found) throw new CaptureValidationError(`${check.label} not found`, "not_found")
  }
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
      select: NOTE_SELECT,
    })
    if (existing) {
      if (existing.workspaceId !== value.workspaceId) {
        throw new CaptureValidationError("idempotencyKey belongs to another workspace")
      }
      return { note: existing, created: false }
    }
  }

  await resolveSubjects(db, value.workspaceId, value)

  try {
    const note = await db.note.create({
      data: {
        ...(id ? { id } : {}),
        workspaceId: value.workspaceId,
        timestamp: value.timestamp,
        type: value.type,
        content: value.content,
        metadata,
        aboutPersonId: value.aboutPersonId,
        aboutPlaceId: value.aboutPlaceId,
        aboutItemId: value.aboutItemId,
        aboutEventId: value.aboutEventId,
        aboutPlanId: value.aboutPlanId,
        aboutGroupId: value.aboutGroupId,
        aboutStateId: value.aboutStateId,
      },
      select: NOTE_SELECT,
    })
    return { note, created: true }
  } catch (error) {
    if (!id || !error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error
    const existing = await db.note.findUnique({
      where: { id },
      select: NOTE_SELECT,
    })
    if (!existing || existing.workspaceId !== value.workspaceId) throw error
    return { note: existing, created: false }
  }
}
