import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import { createTestDatabase, type TestDatabase } from "@life-os/db/testing"

let testDb: TestDatabase
before(async () => { testDb = await createTestDatabase() })
after(async () => { await testDb?.drop() })

// 165 pending visits describing three places, 154 of them one address the phone
// sees daily. These pin that the decision is the place, and that answering it
// once is what stops it being asked again.

const WS = "staged-visits-test"
const HOME_PLACE_ID = "ChIJT9ZLGc-_yIARq-q9j0YGmxc"

async function seed(count: number) {
  const { db } = await import("@life-os/db")
  await db.workspace.upsert({ where: { id: WS }, update: {}, create: { id: WS, name: "Staged Visits Test", slug: WS } })
  const job = await db.importJob.create({ data: { workspaceId: WS, format: "google-timeline", filename: "t.json", status: "done" } })
  for (let i = 0; i < count; i++) {
    await db.importStagedVisit.create({ data: {
      workspaceId: WS, importJobId: job.id, rawData: "{}", status: "pending",
      placeName: "Red Rock Villas Apartments", placeAddress: "451 Crestdale Ln, Las Vegas, NV 89144, USA",
      googlePlaceId: HOME_PLACE_ID, latitude: 36.15, longitude: -115.32,
      // Days apart, so none of them read as duplicates of each other.
      startedAt: new Date(Date.UTC(2026, 2, 31 + i * 2, 18)), confidence: 80,
    } })
  }
  return db
}

async function cleanup() {
  const { db } = await import("@life-os/db")
  await db.importStagedVisit.deleteMany({ where: { workspaceId: WS } })
  await db.event.deleteMany({ where: { workspaceId: WS } })
  await db.place.deleteMany({ where: { workspaceId: WS } })
  await db.graphEvent.deleteMany({ where: { workspaceId: WS } })
  await db.importJob.deleteMany({ where: { workspaceId: WS } })
}

test("one answer resolves every pending visit at that place", async () => {
  const db = await seed(12)
  const { resolveVisitGroup } = await import("../staged-visits")
  try {
    const result = await resolveVisitGroup({ selector: { googlePlaceId: HOME_PLACE_ID }, action: "accept", workspaceId: WS })

    assert.equal(result.matched, 12)
    assert.equal(result.resolved, 12, "the whole place clears in one decision, not one visit at a time")
    assert.equal(result.remaining, 0)
    assert.equal(await db.importStagedVisit.count({ where: { workspaceId: WS, status: "pending" } }), 0)

    // Twelve stays are twelve events. Collapsing the decision must not collapse
    // the history it is deciding about.
    assert.equal(result.eventsCreated, 12)
    assert.equal(await db.event.count({ where: { workspaceId: WS, placeId: result.placeId! } }), 12)
  } finally { await cleanup() }
})

test("the Place it creates carries the id that stops the question recurring", async () => {
  const db = await seed(3)
  const { resolveVisitGroup } = await import("../staged-visits")
  try {
    const result = await resolveVisitGroup({ selector: { googlePlaceId: HOME_PLACE_ID }, action: "accept", workspaceId: WS })
    const place = await db.place.findFirstOrThrow({ where: { id: result.placeId! } })
    // upsertPlace in the importer matches on googlePlaceId first, so a future
    // import of the same address resolves here instead of staging again.
    assert.equal(place.googlePlaceId, HOME_PLACE_ID)
    assert.equal(place.name, "Red Rock Villas Apartments")
    assert.ok(place.coordinates, "coordinates travel with it, so the map link keeps working")
  } finally { await cleanup() }
})

test("resolving twice does not double the history", async () => {
  const db = await seed(4)
  const { resolveVisitGroup } = await import("../staged-visits")
  try {
    const first = await resolveVisitGroup({ selector: { googlePlaceId: HOME_PLACE_ID }, action: "accept", workspaceId: WS })
    // Re-staging the same visits (a re-import of the same file) must land on the
    // existing Place and existing Events rather than duplicating both.
    const job = await db.importJob.findFirstOrThrow({ where: { workspaceId: WS } })
    for (let i = 0; i < 4; i++) {
      await db.importStagedVisit.create({ data: {
        workspaceId: WS, importJobId: job.id, rawData: "{}", status: "pending",
        placeName: "Red Rock Villas Apartments", googlePlaceId: HOME_PLACE_ID,
        latitude: 36.15, longitude: -115.32,
        startedAt: new Date(Date.UTC(2026, 2, 31 + i * 2, 18)), confidence: 80,
      } })
    }
    const second = await resolveVisitGroup({ selector: { googlePlaceId: HOME_PLACE_ID }, action: "accept", workspaceId: WS })

    assert.equal(second.placeId, first.placeId, "the second pass finds the Place, it does not make another")
    assert.equal(second.eventsCreated, 0)
    assert.equal(second.duplicatesSkipped, 4)
    assert.equal(await db.event.count({ where: { workspaceId: WS } }), 4)
  } finally { await cleanup() }
})

test("dismissing a place clears it without inventing a Place or events", async () => {
  const db = await seed(5)
  const { resolveVisitGroup } = await import("../staged-visits")
  try {
    const result = await resolveVisitGroup({ selector: { googlePlaceId: HOME_PLACE_ID }, action: "dismiss", workspaceId: WS })
    assert.equal(result.resolved, 5)
    assert.equal(result.placeId, null)
    assert.equal(await db.place.count({ where: { workspaceId: WS } }), 0)
    assert.equal(await db.event.count({ where: { workspaceId: WS } }), 0)
    assert.equal(await db.importStagedVisit.count({ where: { workspaceId: WS, status: "rejected" } }), 5)
  } finally { await cleanup() }
})

test("an empty selector is refused rather than matching everything", async () => {
  await seed(2)
  const { resolveVisitGroup, StagedVisitError } = await import("../staged-visits")
  try {
    await assert.rejects(
      () => resolveVisitGroup({ selector: {}, action: "accept", workspaceId: WS }),
      (error: unknown) => error instanceof StagedVisitError && error.code === "validation",
      "accept with no place must never mean accept everything",
    )
  } finally { await cleanup() }
})
