import { publishGraphEvent, type GraphEventActor } from "./events"
import { writeAuditLog, type AuditActor } from "./audit"

// Extracted from apps/persons/server/domain/places.ts's write operations
// (Track C, phase C4) — named place-notes.ts, not places.ts, because that
// is genuinely all this file's writes are: PlaceNote CRUD and the favorite
// toggle. Everything else in the original places.ts (getPlacesForMap,
// getPlaceProfile, derivePlaceData and its ~300 lines of timeline/stats
// derivation) is read-shaping for a dashboard view, not a domain write —
// it stays exactly where it was, in apps/persons/server/domain/places.ts,
// untouched. There is no createPlace/updatePlace/deletePlace anywhere in
// this codebase yet; Place records are created by import/map flows this
// phase doesn't touch.

export class PlaceNoteError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "PlaceNoteError"
  }
}

export async function createPlaceNote(
  placeId: string,
  workspaceId: string | null | undefined,
  body: unknown,
  opts: { eventId?: unknown; actor?: GraphEventActor & AuditActor } = {},
) {
  const { db } = await import("@life-os/db")
  const wsId = workspaceId ?? "default-workspace"
  const place = await db.place.findFirst({ where: { id: placeId, workspaceId: wsId }, select: { id: true } })
  if (!place) throw new PlaceNoteError("Place not found", "not_found")

  const eventId = typeof opts.eventId === "string" && opts.eventId.trim() ? opts.eventId.trim() : null
  if (eventId) {
    const event = await db.event.findFirst({ where: { id: eventId, workspaceId: wsId }, select: { id: true, placeId: true } })
    if (!event) throw new PlaceNoteError("Event not found", "not_found")
    if (event.placeId !== placeId) throw new PlaceNoteError("Event does not belong to this place", "validation")
  }

  const content = requiredString(body, "body")

  const note = await db.$transaction(async tx => {
    const created = await tx.placeNote.create({ data: { placeId, workspaceId: wsId, body: content, eventId } })
    await publishGraphEvent(tx, {
      workspaceId: wsId,
      subjectType: "Place",
      subjectId: placeId,
      eventType: "place.note.create",
      actor: opts.actor,
      idempotencyKey: `place-note-create:${created.id}`,
      payload: { noteId: created.id, eventId },
    })
    return created
  })

  await writeAuditLog({ actor: opts.actor, action: "place.note.create", targetType: "place", targetId: placeId, metadata: { noteId: note.id, eventId } })
  return note
}

export async function updatePlaceNote(noteId: string, workspaceId: string | null | undefined, body: unknown, actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const wsId = workspaceId ?? "default-workspace"
  const existing = await db.placeNote.findFirst({ where: { id: noteId, workspaceId: wsId } })
  if (!existing) throw new PlaceNoteError("Place note not found", "not_found")
  const content = requiredString(body, "body")

  const note = await db.$transaction(async tx => {
    const updated = await tx.placeNote.update({ where: { id: noteId }, data: { body: content } })
    await publishGraphEvent(tx, {
      workspaceId: wsId,
      subjectType: "Place",
      subjectId: existing.placeId,
      eventType: "place.note.update",
      actor,
      idempotencyKey: `place-note-update:${noteId}:${Date.now()}`,
      payload: { noteId },
    })
    return updated
  })

  await writeAuditLog({ actor, action: "place.note.update", targetType: "place", targetId: existing.placeId, metadata: { noteId } })
  return note
}

export async function deletePlaceNote(noteId: string, workspaceId: string | null | undefined, actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const wsId = workspaceId ?? "default-workspace"
  const existing = await db.placeNote.findFirst({ where: { id: noteId, workspaceId: wsId } })
  if (!existing) throw new PlaceNoteError("Place note not found", "not_found")

  await db.$transaction(async tx => {
    await tx.placeNote.delete({ where: { id: noteId } })
    await publishGraphEvent(tx, {
      workspaceId: wsId,
      subjectType: "Place",
      subjectId: existing.placeId,
      eventType: "place.note.delete",
      actor,
      idempotencyKey: `place-note-delete:${noteId}`,
      payload: { noteId },
    })
  })

  await writeAuditLog({ actor, action: "place.note.delete", targetType: "place", targetId: existing.placeId, metadata: { noteId } })
}

export async function togglePlaceFavorite(placeId: string, workspaceId: string | null | undefined, actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const wsId = workspaceId ?? "default-workspace"
  const place = await db.place.findFirst({ where: { id: placeId, workspaceId: wsId } })
  if (!place) throw new PlaceNoteError("Place not found", "not_found")

  const updated = await db.$transaction(async tx => {
    const toggled = await tx.place.update({ where: { id: placeId }, data: { favorite: !place.favorite } })
    await publishGraphEvent(tx, {
      workspaceId: wsId,
      subjectType: "Place",
      subjectId: placeId,
      eventType: "place.favorite.toggle",
      actor,
      idempotencyKey: `place-favorite-toggle:${placeId}:${Date.now()}`,
      payload: { favorite: toggled.favorite },
    })
    return toggled
  })

  await writeAuditLog({ actor, action: "place.favorite.toggle", targetType: "place", targetId: placeId, metadata: { favorite: updated.favorite } })
  return updated
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new PlaceNoteError(`${field} is required`, "validation")
  return value.trim()
}
