import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_EXPLORER_STATE,
  explorerFacetCounts,
  explorerStateFromParams,
  filterAndSortPlaces,
  placeTypes,
  sparseFilterCounts,
  updateExplorerParams,
  type ExplorerPlace,
} from "../components/map/explorer-state"

const places: ExplorerPlace[] = [
  {
    id: "recent-cafe",
    name: "Café Réveille",
    address: "Mission Bay",
    latitude: 37.77,
    longitude: -122.39,
    placeType: "cafe",
    favorite: true,
    stats: {
      visitCount: 8,
      photoCount: 2,
      personCount: 1,
      noteCount: 1,
      planCount: 0,
      totalSpend: 42,
      firstVisitAt: "2026-01-20T12:00:00.000Z",
      lastVisitAt: "2026-07-20T12:00:00.000Z",
    },
  },
  {
    id: "old-park",
    name: "Golden Gate Park",
    address: "San Francisco",
    latitude: 37.77,
    longitude: -122.48,
    placeType: "park",
    stats: {
      visitCount: 3,
      photoCount: 0,
      personCount: 0,
      noteCount: 0,
      planCount: 1,
      firstVisitAt: "2020-02-01T12:00:00.000Z",
      lastVisitAt: "2024-02-01T12:00:00.000Z",
    },
  },
  {
    id: "unvisited",
    name: "Saved place",
    stats: {
      visitCount: 0,
      photoCount: 0,
      personCount: 0,
      noteCount: 0,
      planCount: 0,
    },
  },
]

test("explorer URL state parses known values and ignores invalid ones", () => {
  const state = explorerStateFromParams(new URLSearchParams("mode=review&view=list&q=cafe&sort=visits&type=cafe&recency=30d&minVisits=3&place=p1"))
  assert.deepEqual(state, {
    mode: "review",
    view: "list",
    query: "cafe",
    sort: "visits",
    type: "cafe",
    recency: "30d",
    firstVisited: "any",
    minVisits: 3,
    bounds: null,
    selectedId: "p1",
  })
  assert.deepEqual(
    explorerStateFromParams(new URLSearchParams("mode=nope&view=nope&sort=nope")),
    DEFAULT_EXPLORER_STATE,
  )
})

test("map bounds serialize into URL state and filter only after an explicit area search", () => {
  const bounds = { west: -122.42, south: 37.7, east: -122.35, north: 37.82 }
  const params = updateExplorerParams(new URLSearchParams(), { bounds })
  assert.equal(params.get("bounds"), "-122.42000,37.70000,-122.35000,37.82000")
  assert.deepEqual(explorerStateFromParams(params).bounds, bounds)
  const result = filterAndSortPlaces(places, { ...DEFAULT_EXPLORER_STATE, bounds })
  assert.deepEqual(result.map(place => place.id), ["recent-cafe"])
})

test("explorer URL updates remain compact and preserve unrelated map state", () => {
  const current = new URLSearchParams("legend=collapsed&zoom=12")
  const next = updateExplorerParams(current, { query: "Mission", sort: "name", selectedId: "p1" })
  assert.equal(next.get("legend"), "collapsed")
  assert.equal(next.get("zoom"), "12")
  assert.equal(next.get("q"), "Mission")
  assert.equal(next.get("sort"), "name")
  assert.equal(next.get("place"), "p1")
  const reset = updateExplorerParams(next, { query: "", sort: "recent", selectedId: null })
  assert.equal(reset.has("q"), false)
  assert.equal(reset.has("sort"), false)
  assert.equal(reset.has("place"), false)
})

test("search is accent-insensitive and filters compose before sorting", () => {
  const result = filterAndSortPlaces(places, {
    ...DEFAULT_EXPLORER_STATE,
    query: "cafe reveille",
    type: "cafe",
    minVisits: 5,
  }, new Date("2026-07-26T12:00:00.000Z"))
  assert.deepEqual(result.map(place => place.id), ["recent-cafe"])

  const older = filterAndSortPlaces(places, {
    ...DEFAULT_EXPLORER_STATE,
    recency: "older",
  }, new Date("2026-07-26T12:00:00.000Z"))
  assert.deepEqual(older.map(place => place.id), ["old-park"])
})

test("facet counts expose only data-backed enrichment opportunities", () => {
  assert.deepEqual(placeTypes(places), [
    { value: "cafe", count: 1 },
    { value: "park", count: 1 },
    { value: "uncategorized", count: 1 },
  ])
  assert.deepEqual(sparseFilterCounts(places), {
    favorites: 1,
    people: 1,
    photos: 1,
    notes: 1,
    spending: 1,
    plans: 1,
  })
  assert.deepEqual(explorerFacetCounts(places, new Date("2026-07-26T12:00:00.000Z")), {
    recency: { "30d": 1, "1y": 1, older: 1 },
    firstVisited: { "1y": 1, older: 1 },
    minVisits: { 2: 2, 5: 1, 10: 0 },
  })
})
