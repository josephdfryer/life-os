import test, { after } from "node:test"
import assert from "node:assert/strict"
import { createTestDatabase, type TestDatabase } from "@life-os/db/testing"

type TestModules = {
  db: typeof import("../lib/db")["db"]
  places: typeof import("../server/domain/places")
  mapLayers: typeof import("../server/domain/map-layers")
}

let modulesPromise: Promise<TestModules> | null = null
let testDb: TestDatabase | null = null

async function setup() {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      testDb = await createTestDatabase()
      const [dbModule, places, mapLayers] = await Promise.all([
        import("../lib/db"),
        import("../server/domain/places"),
        import("../server/domain/map-layers"),
      ])
      return { db: dbModule.db, places, mapLayers }
    })()
  }
  return modulesPromise
}

after(async () => {
  await testDb?.drop()
})

test("places map and profile derive stats from events, interactions, groups, photos, spend, and notes", async () => {
  const { db, places } = await setup()
  const { createPlaceNote, getPlaceProfile, getPlacesForMap } = places

  const workspace = await db.workspace.create({
    data: { id: "test-workspace", name: "Test LifeOS", slug: "test-life-os" },
  })
  const place = await db.place.create({
    data: {
      workspaceId: workspace.id,
      name: "Blue Bottle Hayes",
      type: "cafe",
      address: "315 Linden St, San Francisco",
      coordinates: JSON.stringify({ lat: 37.776, lng: -122.424 }),
      favorite: true,
    },
  })
  const [qin, maya] = await Promise.all([
    db.person.create({ data: { workspaceId: workspace.id, first: "Qin", last: "Li" } }),
    db.person.create({ data: { workspaceId: workspace.id, first: "Maya", last: "Fryer" } }),
  ])
  const group = await db.group.create({
    data: { workspaceId: workspace.id, name: "Fryer Family", groupType: "family" },
  })
  await db.personGroup.createMany({
    data: [
      { groupId: group.id, personId: qin.id },
      { groupId: group.id, personId: maya.id },
    ],
  })
  const corporation = await db.group.create({
    data: { workspaceId: workspace.id, name: "Blue Bottle Coffee", groupType: "corporation" },
  })
  await db.placeGroup.create({
    data: { placeId: place.id, groupId: corporation.id, relationshipType: "corporate_parent" },
  })
  const otherWorkspace = await db.workspace.create({
    data: { id: "other-workspace", name: "Other Workspace", slug: "other-workspace" },
  })
  const otherGroup = await db.group.create({
    data: { workspaceId: otherWorkspace.id, name: "Other Workspace Group", groupType: "community" },
  })
  await db.placeGroup.create({
    data: { placeId: place.id, groupId: otherGroup.id, relationshipType: "usual_spot" },
  })
  const event = await db.event.create({
    data: {
      workspaceId: workspace.id,
      placeId: place.id,
      name: "Saturday coffee",
      type: "coffee",
      start: new Date("2026-04-18T17:00:00Z"),
      end: new Date("2026-04-18T18:15:00Z"),
      timestamp: new Date("2026-04-18T17:00:00Z"),
      groupTags: { connect: [{ id: group.id }] },
    },
  })
  await db.event.create({
    data: {
      workspaceId: otherWorkspace.id,
      placeId: place.id,
      name: "Other workspace visit",
      type: "coffee",
      start: new Date("2026-04-19T17:00:00Z"),
      timestamp: new Date("2026-04-19T17:00:00Z"),
    },
  })
  await db.interaction.createMany({
    data: [
      { workspaceId: workspace.id, personId: qin.id, eventId: event.id, placeId: place.id, type: "coffee", timestamp: event.timestamp, amount: 1825 },
      { workspaceId: workspace.id, personId: maya.id, eventId: event.id, placeId: place.id, type: "coffee", timestamp: event.timestamp },
    ],
  })
  const photo = await db.item.create({
    data: { workspaceId: workspace.id, name: "Coffee photo.jpg", category: "photo", assetId: "PHOTO-001" },
  })
  const qinInteraction = await db.interaction.findFirstOrThrow({ where: { personId: qin.id, eventId: event.id } })
  await db.itemInteraction.create({ data: { itemId: photo.id, interactionId: qinInteraction.id, role: "context" } })
  await createPlaceNote(place.id, workspace.id, "Great window seat.", { eventId: event.id })
  await db.plan.create({
    data: {
      workspaceId: workspace.id,
      placeId: place.id,
      text: "Return for a quiet writing morning",
      scheduledStart: new Date("2026-08-01T16:00:00Z"),
    },
  })
  await db.placeNote.create({
    data: {
      placeId: place.id,
      workspaceId: otherWorkspace.id,
      body: "This note belongs to another workspace.",
    },
  })

  const map = await getPlacesForMap(workspace.id)
  assert.equal(map.length, 1)
  assert.equal(map[0].favorite, true)
  assert.equal(map[0].stats.visitCount, 1)
  assert.equal(map[0].stats.photoCount, 1)
  assert.equal(map[0].stats.personCount, 2)
  assert.equal(map[0].stats.groupCount, 2)
  assert.equal(map[0].stats.noteCount, 1)
  assert.equal(map[0].stats.planCount, 1)
  assert.equal(map[0].stats.totalSpend, 18.25)
  assert.equal(map[0].financialGroup?.name, "Blue Bottle Coffee")
  assert.equal(map[0].weight, 36)

  const profile = await getPlaceProfile(place.id, workspace.id)
  assert.equal(profile.stats.visitCount, 1)
  assert.equal(profile.stats.personCount, 2)
  assert.equal(profile.stats.totalSpend, 18.25)
  assert.equal(profile.timeline[0].eventId, event.id)
  assert.equal(profile.timeline[0].endedAt, "2026-04-18T18:15:00.000Z")
  assert.equal(profile.timeline[0].photoCount, 1)
  assert.equal(profile.timeline[0].photos[0].name, "Coffee photo.jpg")
  assert.equal(profile.timeline[0].notePreview, "Great window seat.")
  assert.deepEqual(profile.people.map(person => person.name).sort(), ["Maya Fryer", "Qin Li"])
  assert.equal(profile.groups.affiliated[0].name, "Blue Bottle Coffee")
  assert.equal(profile.groups.activity[0].name, "Fryer Family")
  assert.equal(profile.plans[0].title, "Return for a quiet writing morning")
})

test("place meaning is explicitly authored, validated, and workspace scoped", async () => {
  const { db, places } = await setup()
  const workspace = await db.workspace.create({
    data: { id: "meaning-workspace", name: "Meaning Workspace", slug: "meaning-workspace" },
  })
  const place = await db.place.create({
    data: { workspaceId: workspace.id, name: "The Overlook" },
  })

  const updated = await places.updatePlaceMeaning(place.id, workspace.id, "Where I decided to move west.")
  assert.equal(updated.meaning, "Where I decided to move west.")
  await assert.rejects(
    () => places.updatePlaceMeaning(place.id, "other-workspace", "Should not save"),
    /Place not found/,
  )
  const cleared = await places.updatePlaceMeaning(place.id, workspace.id, "   ")
  assert.equal(cleared.meaning, null)
})

test("place note CRUD creates, updates, and deletes notes in the selected workspace", async () => {
  const { db, places } = await setup()
  const { createPlaceNote, deletePlaceNote, getPlaceProfile, updatePlaceNote } = places

  const workspace = await db.workspace.create({
    data: { id: "notes-workspace", name: "Notes Workspace", slug: "notes-workspace" },
  })
  const place = await db.place.create({
    data: { workspaceId: workspace.id, name: "Home Office" },
  })

  const note = await createPlaceNote(place.id, workspace.id, "First draft")
  let profile = await getPlaceProfile(place.id, workspace.id)
  assert.equal(profile.notes.length, 1)
  assert.equal(profile.notes[0].body, "First draft")

  await updatePlaceNote(note.id, workspace.id, "Updated note")
  profile = await getPlaceProfile(place.id, workspace.id)
  assert.equal(profile.notes[0].body, "Updated note")

  await deletePlaceNote(note.id, workspace.id)
  profile = await getPlaceProfile(place.id, workspace.id)
  assert.equal(profile.notes.length, 0)
})

test("places map layer data includes unresolved AI enrichment and interaction overlays", async () => {
  const { db } = await setup()
  const mapLayers = await import("../server/domain/map-layers")
  const workspace = await db.workspace.create({
    data: { id: "map-layers-workspace", name: "Map Layers", slug: "map-layers" },
  })
  const place = await db.place.create({
    data: {
      workspaceId: workspace.id,
      name: "Market Cafe",
      coordinates: JSON.stringify({ latitude: 37.78, longitude: -122.41 }),
    },
  })
  const person = await db.person.create({ data: { workspaceId: workspace.id, first: "Jonny", last: "Appleseed" } })
  const event = await db.event.create({
    data: {
      workspaceId: workspace.id,
      placeId: place.id,
      name: "Quick coffee",
      type: "coffee",
      start: new Date("2026-05-01T16:00:00Z"),
      timestamp: new Date("2026-05-01T16:00:00Z"),
    },
  })
  await db.interaction.create({
    data: {
      workspaceId: workspace.id,
      personId: person.id,
      eventId: event.id,
      type: "coffee",
      timestamp: event.timestamp,
      summary: "Caught up after the meeting.",
    },
  })
  const otherWorkspace = await db.workspace.create({
    data: { id: "map-layers-other-workspace", name: "Other Map Layers", slug: "other-map-layers" },
  })
  const otherPlace = await db.place.create({
    data: {
      workspaceId: otherWorkspace.id,
      name: "Private merchant",
      googlePlaceId: "other-private-merchant",
      coordinates: JSON.stringify({ latitude: 37.79, longitude: -122.42 }),
    },
  })
  await db.interaction.create({
    data: {
      workspaceId: otherWorkspace.id,
      placeId: otherPlace.id,
      type: "financial",
      timestamp: new Date("2026-05-01T18:00:00Z"),
      amount: 9900,
      summary: "Other workspace purchase",
    },
  })
  const job = await db.importJob.create({
    data: { workspaceId: workspace.id, status: "done", format: "timeline_records", filename: "layers.json", totalRows: 1, stagedRows: 1 },
  })
  await db.importStagedVisit.create({
    data: {
      importJobId: job.id,
      workspaceId: workspace.id,
      rawData: { source: "test" },
      latitude: 37.781,
      longitude: -122.411,
      startedAt: new Date("2026-05-02T17:00:00Z"),
      confidence: 64,
      aiEnrichment: {
        placeName: "Likely Market Cafe",
        category: "coffee_shop",
        confidence: 0.82,
        reasoning: "Nearby known cafe and visit duration fit.",
      },
    },
  })

  const layers = await mapLayers.getMapLayerData(workspace.id, [place.id])
  assert.equal(layers.unresolvedVisits.length, 1)
  assert.equal(layers.unresolvedVisits[0].aiEnrichment?.placeName, "Likely Market Cafe")
  assert.equal(layers.interactions.length, 1)
  assert.equal(layers.interactions[0].placeId, place.id)
  assert.equal(layers.interactions[0].interactionCount, 1)
  assert.deepEqual(layers.finance, [])
  assert.deepEqual(layers.photos, [])
})

test("google maps legacy import auto-creates confident visits and stages ambiguous ones", async () => {
  const { db } = await setup()
  const mapsImport = await import("../server/domain/import")
  const workspace = await db.workspace.create({
    data: { id: "maps-import-workspace", name: "Maps Import", slug: "maps-import" },
  })
  const payload = {
    timelineObjects: [
      {
        placeVisit: {
          location: {
            name: "Blue Bottle Coffee",
            address: "315 Linden St, San Francisco",
            latitudeE7: 377760000,
            longitudeE7: -1224240000,
            placeId: "google-blue-bottle",
            locationConfidence: 92,
          },
          duration: { startTimestamp: "2024-06-01T15:00:00Z", endTimestamp: "2024-06-01T16:00:00Z" },
          visitConfidence: 88,
          placeConfidence: "HIGH_CONFIDENCE",
        },
      },
      {
        placeVisit: {
          location: {
            name: "Maybe Park",
            address: "Somewhere",
            latitudeE7: 377770000,
            longitudeE7: -1224250000,
            placeId: "google-maybe-park",
          },
          duration: { startTimestamp: "2024-06-02T15:00:00Z", endTimestamp: "2024-06-02T15:45:00Z" },
          visitConfidence: 42,
          placeConfidence: "LOW_CONFIDENCE",
        },
      },
    ],
  }

  const visits = await mapsImport.parseFile(Buffer.from(JSON.stringify(payload)))
  assert.equal(mapsImport.detectFormat(payload), "legacy_takeout")
  assert.equal(visits.length, 2)
  assert.equal(mapsImport.normalizeConfidence(visits[0]), 89)

  const job = await mapsImport.createImportJob({
    workspaceId: workspace.id,
    filename: "2024_JUNE.json",
    buffer: Buffer.from(JSON.stringify(payload)),
  })
  assert.equal(job.status, "done")
  assert.equal(job.createdRows, 1)
  assert.equal(job.stagedRows, 1)

  const place = await db.place.findFirstOrThrow({ where: { workspaceId: workspace.id, googlePlaceId: "google-blue-bottle" } })
  const event = await db.event.findFirstOrThrow({ where: { workspaceId: workspace.id, placeId: place.id } })
  assert.equal(event.type, "visit")

  const staged = await mapsImport.listStagedVisits(job.id, workspace.id)
  assert.equal(staged.total, 1)
  assert.equal(staged.items[0].placeName, "Maybe Park")
  const preview = await mapsImport.bulkUpdateStagedVisits(job.id, workspace.id, {
    action: "accept",
    minConfidence: staged.items[0].confidence,
    dryRun: true,
  })
  assert.deepEqual(preview, { matched: 1, updated: 0, dryRun: true })
  const afterPreview = await mapsImport.listStagedVisits(job.id, workspace.id, { status: "pending" })
  assert.equal(afterPreview.total, 1)
})

test("google location-history flat timeline records parse visits and ignore movement paths", async () => {
  await setup()
  const mapsImport = await import("../server/domain/import")
  const payload = [
    {
      startTime: "2024-01-01T10:00:00-08:00",
      endTime: "2024-01-01T11:15:00-08:00",
      visit: {
        probability: "0.940000",
        topCandidate: {
          probability: "0.840000",
          semanticType: "Home",
          placeID: "google-home",
          placeLocation: "geo:34.100000,-118.200000",
        },
      },
    },
    {
      startTime: "2024-01-01T11:15:00-08:00",
      endTime: "2024-01-01T11:45:00-08:00",
      activity: {
        start: "geo:34.100000,-118.200000",
        end: "geo:34.200000,-118.300000",
        distanceMeters: "1000.000000",
      },
    },
    {
      startTime: "2024-01-01T12:00:00-08:00",
      endTime: "2024-01-01T14:00:00-08:00",
      timelinePath: [
        { point: "geo:34.100000,-118.200000", durationMinutesOffsetFromStartTime: "10" },
      ],
    },
  ]

  assert.equal(mapsImport.detectFormat(payload), "timeline_records")
  const visits = await mapsImport.parseFile(Buffer.from(JSON.stringify(payload)))
  assert.equal(visits.length, 1)
  assert.equal(visits[0].googlePlaceId, "google-home")
  assert.equal(visits[0].latitude, 34.1)
  assert.equal(visits[0].longitude, -118.2)
  assert.equal(visits[0].semanticType, "Home")
  assert.equal(mapsImport.normalizeConfidence(visits[0]), 92)

  const preview = await mapsImport.previewFile(Buffer.from(JSON.stringify(payload)))
  assert.equal(preview.format, "timeline_records")
  assert.equal(preview.totalRecords, 3)
  assert.equal(preview.totalVisits, 1)
  assert.equal(preview.ignoredRecords, 2)
  assert.equal(preview.uniqueGooglePlaceIds, 1)
  assert.equal(preview.sourceRecordTypes.activity, 1)
  assert.equal(preview.sourceRecordTypes.timelinePath, 1)
  assert.equal(preview.topSemanticTypes[0].label, "Home")
})

test("staged google maps visit can be accepted into a place event", async () => {
  const { db } = await setup()
  const mapsImport = await import("../server/domain/import")
  const workspace = await db.workspace.create({
    data: { id: "maps-review-workspace", name: "Maps Review", slug: "maps-review" },
  })
  const job = await db.importJob.create({
    data: { workspaceId: workspace.id, status: "done", format: "legacy_takeout", filename: "review.json", totalRows: 1, stagedRows: 1 },
  })
  const visit = await db.importStagedVisit.create({
    data: {
      importJobId: job.id,
      workspaceId: workspace.id,
      rawData: { source: "test" },
      placeName: "Review Cafe",
      placeAddress: "1 Review Way",
      latitude: 37.77,
      longitude: -122.42,
      googlePlaceId: "review-cafe",
      startedAt: new Date("2024-06-03T15:00:00Z"),
      endedAt: new Date("2024-06-03T16:00:00Z"),
      confidence: 55,
    },
  })

  const accepted = await mapsImport.updateStagedVisit(job.id, visit.id, workspace.id, "accept")
  assert.equal(accepted.status, "accepted")
  assert.ok(accepted.resolvedPlaceId)
  assert.ok(accepted.resolvedEventId)
})

test("staged visit can merge into an exact workspace Place without duplicates", async () => {
  const { db } = await setup()
  const mapsImport = await import("../server/domain/import")
  const workspace = await db.workspace.create({
    data: { id: "maps-merge-workspace", name: "Maps Merge", slug: "maps-merge" },
  })
  const target = await db.place.create({
    data: {
      workspaceId: workspace.id,
      name: "Existing Cafe",
      coordinates: JSON.stringify({ latitude: 37.77, longitude: -122.42 }),
    },
  })
  const job = await db.importJob.create({
    data: { workspaceId: workspace.id, status: "done", format: "legacy_takeout", filename: "merge.json", totalRows: 1, stagedRows: 1 },
  })
  const visit = await db.importStagedVisit.create({
    data: {
      importJobId: job.id,
      workspaceId: workspace.id,
      rawData: { source: "test" },
      placeName: "Ambiguous Cafe",
      latitude: 37.7701,
      longitude: -122.4201,
      startedAt: new Date("2024-07-03T15:00:00Z"),
      endedAt: new Date("2024-07-03T16:00:00Z"),
      confidence: 61,
    },
  })

  const first = await mapsImport.resolveStagedVisit(job.id, visit.id, workspace.id, { targetPlaceId: target.id })
  assert.equal(first.placeId, target.id)
  assert.equal(first.accepted, true)
  assert.equal(await db.place.count({ where: { workspaceId: workspace.id } }), 1)
  assert.equal(await db.event.count({ where: { workspaceId: workspace.id, placeId: target.id } }), 1)
  const resolved = await db.importStagedVisit.findUniqueOrThrow({ where: { id: visit.id } })
  const event = await db.event.findUniqueOrThrow({ where: { id: resolved.resolvedEventId! } })
  assert.equal(resolved.resolvedPlaceId, target.id)
  assert.equal(JSON.parse(event.metadata ?? "{}").source, "google_maps")

  const second = await mapsImport.resolveStagedVisit(job.id, visit.id, workspace.id, { targetPlaceId: target.id })
  assert.equal(second.skipped, true)
  assert.equal(await db.event.count({ where: { workspaceId: workspace.id, placeId: target.id } }), 1)
})

test("staged visit can create a named Place through a validated override", async () => {
  const { db } = await setup()
  const mapsImport = await import("../server/domain/import")
  const workspace = await db.workspace.create({
    data: { id: "maps-create-workspace", name: "Maps Create", slug: "maps-create" },
  })
  const job = await db.importJob.create({
    data: { workspaceId: workspace.id, status: "done", format: "legacy_takeout", filename: "create.json", totalRows: 1, stagedRows: 1 },
  })
  const visit = await db.importStagedVisit.create({
    data: {
      importJobId: job.id,
      workspaceId: workspace.id,
      rawData: { source: "test" },
      latitude: 34.1,
      longitude: -118.2,
      startedAt: new Date("2024-08-03T15:00:00Z"),
      confidence: 58,
    },
  })

  const result = await mapsImport.resolveStagedVisit(job.id, visit.id, workspace.id, {
    placeOverride: {
      placeName: "Joseph's Trailhead",
      placeAddress: "Trail Road",
      placeType: "trailhead",
    },
  })
  const place = await db.place.findFirstOrThrow({ where: { id: result.placeId!, workspaceId: workspace.id } })
  assert.equal(place.name, "Joseph's Trailhead")
  assert.equal(place.address, "Trail Road")
  assert.equal(place.type, "trailhead")
})

test("a rejected staged visit can be restored to the pending review queue", async () => {
  const { db } = await setup()
  const mapsImport = await import("../server/domain/import")
  const workspace = await db.workspace.create({
    data: { id: "maps-restore-workspace", name: "Maps Restore", slug: "maps-restore" },
  })
  const job = await db.importJob.create({
    data: { workspaceId: workspace.id, status: "done", format: "legacy_takeout", filename: "restore.json", totalRows: 1, stagedRows: 1 },
  })
  const visit = await db.importStagedVisit.create({
    data: {
      importJobId: job.id,
      workspaceId: workspace.id,
      rawData: { source: "test" },
      placeName: "Restore Cafe",
      startedAt: new Date("2024-09-03T15:00:00Z"),
      confidence: 41,
    },
  })

  const rejected = await mapsImport.updateStagedVisit(job.id, visit.id, workspace.id, "reject")
  assert.equal(rejected.status, "rejected")
  const restored = await mapsImport.updateStagedVisit(job.id, visit.id, workspace.id, "restore")
  assert.equal(restored.status, "pending")
})

test("finance map layers aggregate canonical and adjudicated staged spend without loading every interaction", async () => {
  const { db, mapLayers } = await setup()
  const workspace = await db.workspace.create({
    data: { id: "finance-layer-workspace", name: "Finance Layer", slug: "finance-layer" },
  })
  const [cafe, market] = await Promise.all([
    db.place.create({
      data: { workspaceId: workspace.id, name: "Cafe", type: "cafe", googlePlaceId: "google-cafe" },
    }),
    db.place.create({
      data: { workspaceId: workspace.id, name: "Market", type: "shop", googlePlaceId: "google-market" },
    }),
  ])
  await db.interaction.createMany({
    data: [
      { workspaceId: workspace.id, placeId: cafe.id, type: "financial", timestamp: new Date(), amount: 1_000 },
      { workspaceId: workspace.id, placeId: cafe.id, type: "financial", timestamp: new Date(), amount: -250 },
      { workspaceId: workspace.id, placeId: cafe.id, type: "visit", timestamp: new Date(), amount: 9_999 },
    ],
  })
  await db.stagedInteraction.createMany({
    data: [
      {
        workspaceId: workspace.id,
        source: "era",
        sourceId: "staged-cafe",
        status: "pending",
        timestamp: new Date(),
        metadata: JSON.stringify({ amount: 12.34, placeMatch: { band: "auto", merchantPlace: { googlePlaceId: "google-cafe" } } }),
      },
      {
        workspaceId: workspace.id,
        source: "era",
        sourceId: "staged-market",
        status: "pending",
        timestamp: new Date(),
        metadata: JSON.stringify({ amount: 5, placeMatch: { band: "adjudicated", merchantPlace: { googlePlaceId: "google-market" } } }),
      },
      {
        workspaceId: workspace.id,
        source: "era",
        sourceId: "staged-ignored",
        status: "pending",
        timestamp: new Date(),
        metadata: JSON.stringify({ amount: 100, placeMatch: { band: "suggested", merchantPlace: { googlePlaceId: "google-cafe" } } }),
      },
    ],
  })

  const result = (await mapLayers.getFinanceLayerItems(workspace.id)).sort((a, b) => a.placeId.localeCompare(b.placeId))
  const expected = [
    { placeId: cafe.id, transactionCount: 3, totalAmount: 24.84 },
    { placeId: market.id, transactionCount: 1, totalAmount: 5 },
  ].sort((a, b) => a.placeId.localeCompare(b.placeId))
  assert.deepEqual(result, expected)
})
