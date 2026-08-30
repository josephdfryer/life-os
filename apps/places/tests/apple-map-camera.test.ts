import assert from "node:assert/strict"
import test from "node:test"
import { boundsForRegion, cameraForRegion, regionForCamera } from "../components/map/apple-map-camera"

test("MapKit regions round-trip the renderer-neutral camera contract", () => {
  const camera = { lat: 42.3314, lng: -83.0458, zoom: 12.75 }
  const region = regionForCamera(camera, 960, 620)
  const roundTrip = cameraForRegion(region, 960)

  assert.ok(Math.abs(roundTrip.lat - camera.lat) < 0.00001)
  assert.ok(Math.abs(roundTrip.lng - camera.lng) < 0.00001)
  assert.ok(Math.abs(roundTrip.zoom - camera.zoom) < 0.00001)
})

test("MapKit regions produce searchable bounds", () => {
  const bounds = boundsForRegion({
    center: { latitude: 42, longitude: -83 },
    span: { latitudeDelta: 2, longitudeDelta: 4 },
  })

  assert.deepEqual(bounds, { north: 43, south: 41, east: -81, west: -85 })
})

test("bounds preserve regions that cross the antimeridian", () => {
  const bounds = boundsForRegion({
    center: { latitude: 0, longitude: 179 },
    span: { latitudeDelta: 10, longitudeDelta: 8 },
  })

  assert.deepEqual(bounds, { north: 5, south: -5, east: -177, west: 175 })
})
