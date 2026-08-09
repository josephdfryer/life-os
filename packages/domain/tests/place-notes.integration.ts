import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { createPlaceNote, updatePlaceNote, deletePlaceNote, togglePlaceFavorite, PlaceNoteError } from "../place-notes"

// Run against a real (throwaway, migrated) database — the transactional
// GraphEvent publish is exactly the part a pure unit test cannot exercise
// honestly. Not part of `tsx --test tests/*.test.ts`; run manually, same
// convention as event-primitive.integration.ts.

const workspaceId = "place-notes-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Place notes integration", slug: workspaceId } })
  const place = await db.place.create({ data: { workspaceId, name: "Blue Bottle Coffee" } })
  const event = await db.event.create({ data: { workspaceId, name: "Coffee", type: "visit", start: new Date(), timestamp: new Date(), placeId: place.id } })

  // ── create: links a real event, publishes a GraphEvent under subjectType "Place" ──
  const note = await createPlaceNote(place.id, workspaceId, "Great oat milk latte", { eventId: event.id, actor: { type: "system" } })
  assert.equal(note.body, "Great oat milk latte")
  assert.equal(note.eventId, event.id)
  const createEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Place", subjectId: place.id, eventType: "place.note.create" } })
  assert.equal(createEvents.length, 1)

  // ── create: a missing place 404s ──
  await assert.rejects(
    () => createPlaceNote("does-not-exist", workspaceId, "x"),
    (error: unknown) => error instanceof PlaceNoteError && error.code === "not_found",
  )

  // ── create: an event that belongs to a different place is rejected ──
  const otherPlace = await db.place.create({ data: { workspaceId, name: "Other Place" } })
  await assert.rejects(
    () => createPlaceNote(otherPlace.id, workspaceId, "x", { eventId: event.id }),
    (error: unknown) => error instanceof PlaceNoteError && error.code === "validation",
  )

  // ── update: patches the body, publishes a GraphEvent ──
  const updated = await updatePlaceNote(note.id, workspaceId, "Even better with oat milk")
  assert.equal(updated.body, "Even better with oat milk")
  const updateEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Place", subjectId: place.id, eventType: "place.note.update" } })
  assert.equal(updateEvents.length, 1)

  // ── toggle favorite: flips, publishes a GraphEvent, flips back ──
  const favorited = await togglePlaceFavorite(place.id, workspaceId)
  assert.equal(favorited.favorite, true)
  const unfavorited = await togglePlaceFavorite(place.id, workspaceId)
  assert.equal(unfavorited.favorite, false)
  const toggleEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Place", subjectId: place.id, eventType: "place.favorite.toggle" } })
  assert.equal(toggleEvents.length, 2)

  // ── delete: removes the row, then 404s on retry ──
  await deletePlaceNote(note.id, workspaceId)
  assert.equal(await db.placeNote.findUnique({ where: { id: note.id } }), null)
  await assert.rejects(
    () => deletePlaceNote(note.id, workspaceId),
    (error: unknown) => error instanceof PlaceNoteError && error.code === "not_found",
  )

  console.log("All place-notes integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
