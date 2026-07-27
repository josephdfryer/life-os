import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCameraViewport,
  cameraBounds,
  clampCamera,
  clusterPlaces,
  fitCamera,
  markerSize,
  panCamera,
  plotPlaces,
  projectCoordinates,
  zoomCameraAt,
  visibleClusterLabels,
  type MapPlace,
} from "../components/map/map-computation"

function place(id: string, latitude: number, longitude: number, spend = 0): MapPlace {
  return { id, name: id, latitude, longitude, stats: { totalSpend: spend }, weight: 1 }
}

test("camera fitting and viewport projection keep coordinates on the map", () => {
  const places = [place("sf", 37.7749, -122.4194), place("oak", 37.8044, -122.2712)]
  const camera = fitCamera(places, 820, 620)
  assert.ok(camera)
  assert.ok(camera.zoom >= 3 && camera.zoom <= 19)
  const viewport = buildCameraViewport(places, camera, 820, 620)
  assert.equal(viewport.points.length, 2)
  assert.ok(viewport.points.every(point => point.x >= -120 && point.x <= 940 && point.y >= -120 && point.y <= 740))
  assert.ok(viewport.tiles.length > 0)
})

test("camera controls clamp global bounds and preserve cursor anchoring", () => {
  assert.deepEqual(clampCamera({ lat: 100, lng: 540, zoom: 30 }), { lat: 85, lng: -180, zoom: 19 })
  const camera = { lat: 37.7749, lng: -122.4194, zoom: 13 }
  assert.notDeepEqual(panCamera(camera, 100, 50), camera)
  const zoomed = zoomCameraAt(camera, 2, 410, 310, 820, 620)
  assert.ok(Math.abs(zoomed.lat - camera.lat) < 1e-10)
  assert.ok(Math.abs(zoomed.lng - camera.lng) < 1e-10)
  assert.equal(zoomed.zoom, 15)
  const bounds = cameraBounds(camera, 820, 620)
  assert.ok(bounds.north > camera.lat && bounds.south < camera.lat)
  assert.ok(bounds.west < camera.lng && bounds.east > camera.lng)
})

test("clustering groups nearby points and rolls up spend", () => {
  const plotted = [
    { place: place("one", 1, 1, 20), x: 100, y: 100 },
    { place: place("two", 1, 1, 30), x: 104, y: 103 },
  ]
  const clusters = clusterPlaces(plotted, 2)
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].level, "neighborhood")
  assert.equal(clusters[0].totalSpend, 50)
  assert.equal(clusters[0].label, "2 nearby places")
  assert.ok(markerSize(clusters[0].totalSpend, clusters[0].fallbackWeight) > 16)
})

test("cluster identity and collision-aware labels are stable across input order", () => {
  const points = [
    { place: place("b", 1, 1, 5), x: 100, y: 100 },
    { place: place("a", 1, 1, 15), x: 104, y: 102 },
    { place: place("c", 1, 1, 1), x: 300, y: 300 },
  ]
  const forward = clusterPlaces(points, 2)
  const reversed = clusterPlaces(points.toReversed(), 2)
  assert.deepEqual(forward.map(cluster => cluster.id), reversed.map(cluster => cluster.id))

  const singles = clusterPlaces(points, 4)
  const labels = visibleClusterLabels(singles, "b", 100)
  assert.equal(labels.has("b"), true)
  assert.equal(labels.has("c"), true)
  assert.equal(labels.has("a"), false)
})

test("fallback plotting and coordinate overlays remain deterministic without a tile viewport", () => {
  const noCoordinates: MapPlace[] = [
    { id: "one", name: "One", stats: {}, weight: 1 },
    { id: "two", name: "Two", stats: {}, weight: 1 },
  ]
  assert.deepEqual(plotPlaces(noCoordinates).map(point => [point.x, point.y]), [[120, 120], [206, 120]])
  const projected = projectCoordinates([{ id: "visit", latitude: 1, longitude: 2 }], {
    tiles: [], points: [], centerLabel: "none", width: 800, height: 600,
  })
  assert.deepEqual(projected.map(point => [point.x, point.y]), [[96, 528]])
})
