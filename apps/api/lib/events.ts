import { eventsPageContract, eventResourceContract, type EventResource } from "@life-os/contracts"
import { db } from "@life-os/db"

export class EventsApiError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "EventsApiError"
  }
}

export type ListEventsParams = {
  cursor?: string | null
  limit?: number
  type?: string | null
  placeId?: string | null
}

type EventRow = Awaited<ReturnType<typeof db.event.findFirstOrThrow>>

export async function listEvents(params: ListEventsParams, workspaceId: string) {
  const limit = boundedLimit(params.limit)

  const and: Record<string, unknown>[] = []
  if (params.type) and.push({ type: params.type })
  if (params.placeId) and.push({ placeId: params.placeId })
  if (params.cursor) {
    const { timestamp, id } = decodeEventsCursor(params.cursor)
    and.push({ OR: [{ timestamp: { lt: timestamp } }, { timestamp, id: { lt: id } }] })
  }

  const rows = await db.event.findMany({
    where: { workspaceId, ...(and.length ? { AND: and } : {}) } as never,
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: limit + 1,
  })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page.at(-1)
  return eventsPageContract.parse({
    data: page.map(formatEventResource),
    nextCursor: hasMore && last ? encodeEventsCursor(last.timestamp, last.id) : null,
    hasMore,
    limit,
  })
}

export async function getEventResource(id: string, workspaceId: string) {
  const event = await db.event.findFirst({ where: { id, workspaceId } })
  if (!event) throw new EventsApiError("Event not found", "not_found")
  return formatEventResource(event)
}

export function formatEventResource(event: EventRow): EventResource {
  return eventResourceContract.parse({
    id: event.id,
    createdAt: event.createdAt.toISOString(),
    name: event.name,
    type: event.type,
    start: event.start.toISOString(),
    end: event.end?.toISOString() ?? null,
    timestamp: event.timestamp.toISOString(),
    placeId: event.placeId,
    notes: event.notes,
    transcript: event.transcript,
    metadata: event.metadata ? parseMetadata(event.metadata) : null,
    sourcePlanId: event.sourcePlanId,
    parentEventId: event.parentEventId,
    sourceNoteId: event.sourceNoteId,
  })
}

function parseMetadata(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}

function boundedLimit(value: number | undefined) {
  if (value !== undefined && !Number.isFinite(value)) throw new EventsApiError("limit must be a number", "validation")
  return Math.min(500, Math.max(1, Math.round(value ?? 100)))
}

function encodeEventsCursor(timestamp: Date, id: string) {
  return Buffer.from(`${timestamp.toISOString()}|${id}`, "utf8").toString("base64url")
}

function decodeEventsCursor(cursor: string) {
  let decoded: string
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8")
  } catch {
    throw new EventsApiError("cursor is not valid base64url", "validation")
  }
  const separator = decoded.indexOf("|")
  if (separator <= 0) throw new EventsApiError("cursor is malformed", "validation")
  const timestamp = new Date(decoded.slice(0, separator))
  const id = decoded.slice(separator + 1)
  if (Number.isNaN(timestamp.getTime()) || !id) throw new EventsApiError("cursor is malformed", "validation")
  return { timestamp, id }
}
