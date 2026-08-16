import { notesPageContract, noteResourceContract, noteTypeContract, type NoteResource } from "@life-os/contracts"
import { db } from "@life-os/db"

export class NotesApiError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "NotesApiError"
  }
}

export type ListNotesParams = {
  cursor?: string | null
  limit?: number
  q?: string | null
  type?: string | null
  aboutPersonId?: string | null
  aboutPlaceId?: string | null
  aboutItemId?: string | null
  aboutEventId?: string | null
  aboutPlanId?: string | null
  aboutGroupId?: string | null
  aboutStateId?: string | null
}

type NoteResourceRow = {
  id: string
  createdAt: Date
  timestamp: Date
  type: string
  content: string
  metadata: string | null
  sourceFileId: string | null
  aboutPersonId: string | null
  aboutPlaceId: string | null
  aboutItemId: string | null
  aboutEventId: string | null
  aboutPlanId: string | null
  aboutGroupId: string | null
  aboutStateId: string | null
}

export async function listNotes(params: ListNotesParams, workspaceId: string) {
  const limit = boundedLimit(params.limit)
  const q = params.q?.trim() || null
  if (q && q.length > 500) throw new NotesApiError("q must be 500 characters or fewer", "validation")
  const type = params.type ? noteTypeContract.safeParse(params.type) : null
  if (params.type && type && !type.success) throw new NotesApiError("type is invalid", "validation")

  const and: Record<string, unknown>[] = []
  if (q) and.push({ content: { contains: q } })
  if (params.cursor) {
    const { timestamp, id } = decodeNotesCursor(params.cursor)
    and.push({ OR: [{ timestamp: { lt: timestamp } }, { timestamp, id: { lt: id } }] })
  }

  const rows = await db.note.findMany({
    where: {
      workspaceId,
      ...(type?.success ? { type: type.data } : {}),
      ...(params.aboutPersonId ? { aboutPersonId: params.aboutPersonId } : {}),
      ...(params.aboutPlaceId ? { aboutPlaceId: params.aboutPlaceId } : {}),
      ...(params.aboutItemId ? { aboutItemId: params.aboutItemId } : {}),
      ...(params.aboutEventId ? { aboutEventId: params.aboutEventId } : {}),
      ...(params.aboutPlanId ? { aboutPlanId: params.aboutPlanId } : {}),
      ...(params.aboutGroupId ? { aboutGroupId: params.aboutGroupId } : {}),
      ...(params.aboutStateId ? { aboutStateId: params.aboutStateId } : {}),
      ...(and.length ? { AND: and } : {}),
    } as never,
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: limit + 1,
  })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page.at(-1)
  return notesPageContract.parse({
    data: page.map(formatNoteResource),
    nextCursor: hasMore && last ? encodeNotesCursor(last.timestamp, last.id) : null,
    hasMore,
    limit,
  })
}

export async function getNoteResource(id: string, workspaceId: string) {
  const note = await db.note.findFirst({ where: { id, workspaceId } })
  if (!note) throw new NotesApiError("Note not found", "not_found")
  return formatNoteResource(note)
}

export function formatNoteResource(note: NoteResourceRow): NoteResource {
  return noteResourceContract.parse({
    id: note.id,
    createdAt: note.createdAt.toISOString(),
    timestamp: note.timestamp.toISOString(),
    type: note.type,
    content: note.content,
    metadata: note.metadata ? parseMetadata(note.metadata) : null,
    sourceFileId: note.sourceFileId,
    aboutPersonId: note.aboutPersonId,
    aboutPlaceId: note.aboutPlaceId,
    aboutItemId: note.aboutItemId,
    aboutEventId: note.aboutEventId,
    aboutPlanId: note.aboutPlanId,
    aboutGroupId: note.aboutGroupId,
    aboutStateId: note.aboutStateId,
  })
}

function parseMetadata(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}

function boundedLimit(value: number | undefined) {
  if (value !== undefined && !Number.isFinite(value)) throw new NotesApiError("limit must be a number", "validation")
  return Math.min(500, Math.max(1, Math.round(value ?? 100)))
}

function encodeNotesCursor(timestamp: Date, id: string) {
  return Buffer.from(`${timestamp.toISOString()}|${id}`, "utf8").toString("base64url")
}

function decodeNotesCursor(cursor: string) {
  let decoded: string
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8")
  } catch {
    throw new NotesApiError("cursor is not valid base64url", "validation")
  }
  const separator = decoded.indexOf("|")
  if (separator <= 0) throw new NotesApiError("cursor is malformed", "validation")
  const timestamp = new Date(decoded.slice(0, separator))
  const id = decoded.slice(separator + 1)
  if (Number.isNaN(timestamp.getTime()) || !id) throw new NotesApiError("cursor is malformed", "validation")
  return { timestamp, id }
}
