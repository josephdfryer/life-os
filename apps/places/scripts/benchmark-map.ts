import { performance } from "node:perf_hooks"
import {
  buildCameraViewport,
  clusterPlaces,
  fitCamera,
  legacyZoomBucket,
} from "../components/map/map-computation"

const placeCount = 2_000
const iterations = 120
const places = Array.from({ length: placeCount }, (_, index) => ({
  id: `stress-${String(index).padStart(4, "0")}`,
  name: `Stress Place ${index}`,
  latitude: 37.4 + pseudoRandom(index * 2 + 1) * 0.8,
  longitude: -122.6 + pseudoRandom(index * 2 + 2) * 0.9,
  placeType: index % 3 === 0 ? "cafe" : index % 3 === 1 ? "park" : "store",
  stats: { totalSpend: index % 11 === 0 ? index * 1.25 : 0 },
  weight: 1 + index % 12,
}))
const camera = fitCamera(places, 1_440, 900)
if (!camera) throw new Error("stress fixture has no camera")

const samples: number[] = []
let visiblePoints = 0
for (let frame = 0; frame < iterations; frame++) {
  const frameCamera = {
    lat: camera.lat + Math.sin(frame / 12) * 0.04,
    lng: camera.lng + Math.cos(frame / 11) * 0.04,
    zoom: Math.min(17, camera.zoom + (frame % 5) * 0.15),
  }
  const startedAt = performance.now()
  const viewport = buildCameraViewport(places, frameCamera, 1_440, 900)
  clusterPlaces(viewport.points, legacyZoomBucket(viewport.tileZoom ?? 13))
  samples.push(performance.now() - startedAt)
  visiblePoints = Math.max(visiblePoints, viewport.points.length)
}

samples.sort((a, b) => a - b)
const percentile = (value: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * value))]
console.log(JSON.stringify({
  renderer: "custom-dom-osm",
  placeCount,
  iterations,
  maxVisiblePoints: visiblePoints,
  frameComputeMs: {
    median: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    max: round(samples[samples.length - 1]),
  },
}, null, 2))

function pseudoRandom(seed: number) {
  const value = Math.sin(seed * 12_989.23) * 43_758.5453
  return value - Math.floor(value)
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
