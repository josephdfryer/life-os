export type MapPlace = {
  id: string
  name: string
  latitude?: number
  longitude?: number
  placeType?: string
  stats: { totalSpend?: number }
  weight: number
  financialGroup?: { id: string; name: string }
}

type PlaceMapItem = MapPlace
type PlottedPlace = { place: PlaceMapItem; x: number; y: number }
type CoordinateSource = { id: string; latitude?: number; longitude?: number }
type PlottedCoordinate<T> = { item: T; x: number; y: number }
type Tile = { key: string; src: string; left: number; top: number }
type MapViewport = { tiles: Tile[]; points: PlottedPlace[]; centerLabel: string; tileZoom?: number; topLeft?: { x: number; y: number }; width: number; height: number }
export type PlaceCluster = {
  id: string
  places: PlaceMapItem[]
  x: number
  y: number
  totalSpend: number
  fallbackWeight: number
  label: string
  level: "group" | "neighborhood" | "place"
  placeType?: string
}

function coordinatesText(latitude: number, longitude: number) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
}

export function plotPlaces(places: PlaceMapItem[]): PlottedPlace[] {
  const withCoordinates = places.filter(place => typeof place.latitude === "number" && typeof place.longitude === "number")
  if (!withCoordinates.length) {
    return places.map((place, index) => ({
      place,
      x: 120 + (index % 5) * 86,
      y: 120 + (Math.floor(index / 5) % 5) * 72,
    }))
  }
  const lats = withCoordinates.map(place => place.latitude!)
  const lngs = withCoordinates.map(place => place.longitude!)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  return places.map((place, index) => {
    if (typeof place.latitude !== "number" || typeof place.longitude !== "number") {
      return { place, x: 90 + (index % 4) * 42, y: 560 }
    }
    const x = scale(place.longitude, minLng, maxLng)
    const y = 100 - scale(place.latitude, minLat, maxLat)
    return { place, x, y }
  })
}

export type Camera = { lat: number; lng: number; zoom: number }
export type MapBounds = { north: number; south: number; east: number; west: number }

const MIN_ZOOM = 3
const MAX_ZOOM = 19

export function clampCamera(camera: Camera): Camera {
  return {
    lat: Math.max(-85, Math.min(85, camera.lat)),
    lng: ((camera.lng + 540) % 360) - 180,
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom)),
  }
}

export function panCamera(camera: Camera, dxPx: number, dyPx: number): Camera {
  const tz = camera.zoom
  const point = project(camera.lat, camera.lng, tz)
  const next = unproject(point.x + dxPx, point.y + dyPx, tz)
  return { ...next, zoom: camera.zoom }
}

export function cameraBounds(camera: Camera, width: number, height: number): MapBounds {
  const center = project(camera.lat, camera.lng, camera.zoom)
  const northWest = unproject(center.x - width / 2, center.y - height / 2, camera.zoom)
  const southEast = unproject(center.x + width / 2, center.y + height / 2, camera.zoom)
  return {
    north: northWest.lat,
    west: normalizeLongitude(northWest.lng),
    south: southEast.lat,
    east: normalizeLongitude(southEast.lng),
  }
}

// Zoom keeping the geographic point under the cursor fixed — the core of
// the Google Maps pinch feel.
export function zoomCameraAt(camera: Camera, zoomDelta: number, cursorX: number, cursorY: number, width: number, height: number): Camera {
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom + zoomDelta))
  if (newZoom === camera.zoom) return camera
  const dx = cursorX - width / 2
  const dy = cursorY - height / 2
  const before = project(camera.lat, camera.lng, camera.zoom)
  const anchor = unproject(before.x + dx, before.y + dy, camera.zoom)
  const anchorAfter = project(anchor.lat, anchor.lng, newZoom)
  const centerAfter = unproject(anchorAfter.x - dx, anchorAfter.y - dy, newZoom)
  return { ...centerAfter, zoom: newZoom }
}

export function fitCamera(sources: CoordinateSource[], width: number, height: number): Camera | null {
  const withCoordinates = sources.filter(item => typeof item.latitude === "number" && typeof item.longitude === "number")
  if (!withCoordinates.length) return null
  const lat = withCoordinates.reduce((sum, item) => sum + item.latitude!, 0) / withCoordinates.length
  const lng = withCoordinates.reduce((sum, item) => sum + item.longitude!, 0) / withCoordinates.length
  return { lat, lng, zoom: fitTileZoom(withCoordinates, width, height, 1) }
}

export function buildCameraViewport(places: PlaceMapItem[], camera: Camera | null, width: number, height: number): MapViewport {
  if (!camera) {
    return { tiles: [], points: [], centerLabel: "No coordinates yet", width, height }
  }

  const tileZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(camera.zoom)))
  const center = project(camera.lat, camera.lng, tileZoom)
  const topLeft = { x: center.x - width / 2, y: center.y - height / 2 }
  const maxTile = 2 ** tileZoom - 1
  const startX = Math.floor(topLeft.x / 256)
  const endX = Math.floor((topLeft.x + width) / 256)
  const startY = Math.max(0, Math.floor(topLeft.y / 256))
  const endY = Math.min(maxTile, Math.floor((topLeft.y + height) / 256))
  const tiles: Tile[] = []

  for (let x = startX; x <= endX; x++) {
    const wrappedX = ((x % (maxTile + 1)) + maxTile + 1) % (maxTile + 1)
    for (let y = startY; y <= endY; y++) {
      tiles.push({
        key: `${tileZoom}:${x}:${y}`,
        src: `https://tile.openstreetmap.org/${tileZoom}/${wrappedX}/${y}.png`,
        left: x * 256 - topLeft.x,
        top: y * 256 - topLeft.y,
      })
    }
  }

  return {
    tiles,
    points: places.flatMap(place => {
      if (typeof place.latitude !== "number" || typeof place.longitude !== "number") return []
      const point = project(place.latitude, place.longitude, tileZoom)
      const x = point.x - topLeft.x
      const y = point.y - topLeft.y
      // Cull far off-screen markers so panning stays cheap
      if (x < -120 || x > width + 120 || y < -120 || y > height + 120) return []
      return [{ place, x, y }]
    }),
    centerLabel: coordinatesText(camera.lat, camera.lng),
    tileZoom,
    topLeft,
    width,
    height,
  }
}

export function legacyZoomBucket(tileZoom: number) {
  if (tileZoom <= 11) return 1
  if (tileZoom <= 12) return 2
  if (tileZoom <= 14) return 3
  return 4
}

function unproject(x: number, y: number, zoom: number) {
  const scale = 256 * 2 ** zoom
  const lng = (x / scale) * 360 - 180
  const lat = Math.asin(Math.tanh(Math.PI * (1 - (2 * y) / scale))) * 180 / Math.PI
  return { lat, lng }
}

function normalizeLongitude(longitude: number) {
  return ((longitude + 540) % 360) - 180
}

export function projectCoordinates<T extends CoordinateSource>(items: T[], viewport: MapViewport): Array<PlottedCoordinate<T>> {
  if (viewport.tileZoom === undefined || !viewport.topLeft) {
    return items.map((item, index) => ({ item, x: 96 + (index % 5) * 40, y: viewport.height - 72 }))
  }
  return items.flatMap((item, index) => {
    if (typeof item.latitude !== "number" || typeof item.longitude !== "number") {
      return [{ item, x: 96 + (index % 5) * 40, y: viewport.height - 72 }]
    }
    const point = project(item.latitude, item.longitude, viewport.tileZoom!)
    const x = point.x - viewport.topLeft!.x
    const y = point.y - viewport.topLeft!.y
    if (x < -80 || x > viewport.width + 80 || y < -80 || y > viewport.height + 80) return []
    return [{ item, x, y }]
  })
}

function fitTileZoom(places: CoordinateSource[], width: number, height: number, zoomOffset: number) {
  if (places.length <= 1) return 13 + zoomOffset

  const padding = 96
  const availableWidth = Math.max(240, width - padding * 2)
  const availableHeight = Math.max(220, height - padding * 2)
  let fitZoom = 3

  for (let zoom = 18; zoom >= 3; zoom--) {
    const projected = places.map(place => project(place.latitude!, place.longitude!, zoom))
    const xs = projected.map(point => point.x)
    const ys = projected.map(point => point.y)
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanY = Math.max(...ys) - Math.min(...ys)
    if (spanX <= availableWidth && spanY <= availableHeight) {
      fitZoom = zoom
      break
    }
  }

  return Math.min(18, fitZoom + zoomOffset)
}

function project(latitude: number, longitude: number, zoom: number) {
  const sinLat = Math.sin(latitude * Math.PI / 180)
  const scale = 256 * 2 ** zoom
  return {
    x: (longitude + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  }
}

function scale(value: number, min: number, max: number) {
  if (min === max) return 50
  return 8 + ((value - min) / (max - min)) * 84
}

export function clusterPlaces(points: PlottedPlace[], zoom: number): PlaceCluster[] {
  if (zoom <= 1) return clusterByFinancialGroup(points)
  const radius = clusterRadiusForZoom(zoom)
  const stablePoints = points.toSorted((a, b) => a.place.id.localeCompare(b.place.id))
  if (radius === 0) return stablePoints.map(point => clusterFromPoints([point], "place"))

  const clusters: PlottedPlace[][] = []
  for (const point of stablePoints) {
    const cluster = clusters.find(items => {
      const center = centerOf(items)
      return distance(center.x, center.y, point.x, point.y) <= radius
    })
    if (cluster) {
      cluster.push(point)
    } else {
      clusters.push([point])
    }
  }
  return clusters.map(points => clusterFromPoints(points, points.length === 1 ? "place" : "neighborhood"))
}

export function visibleClusterLabels(clusters: PlaceCluster[], selectedId?: string | null, minimumDistance = 92) {
  const accepted: PlaceCluster[] = []
  const ordered = clusters.toSorted((a, b) => {
    const aSelected = a.places.some(place => place.id === selectedId) ? 1 : 0
    const bSelected = b.places.some(place => place.id === selectedId) ? 1 : 0
    return bSelected - aSelected || b.fallbackWeight - a.fallbackWeight || a.id.localeCompare(b.id)
  })
  for (const cluster of ordered) {
    if (cluster.level !== "place") continue
    const isSelected = cluster.places.some(place => place.id === selectedId)
    if (isSelected || accepted.every(item => distance(item.x, item.y, cluster.x, cluster.y) >= minimumDistance)) {
      accepted.push(cluster)
    }
  }
  return new Set(accepted.map(cluster => cluster.id))
}

function clusterRadiusForZoom(zoom: number) {
  if (zoom >= 4) return 0
  return Math.max(5, 24 - zoom * 5)
}

function clusterByFinancialGroup(points: PlottedPlace[]) {
  const byGroup = new Map<string, PlottedPlace[]>()
  for (const point of points.toSorted((a, b) => a.place.id.localeCompare(b.place.id))) {
    const group = point.place.financialGroup
    const key = group ? `group:${group.id}` : `place:${point.place.id}`
    byGroup.set(key, [...(byGroup.get(key) ?? []), point])
  }
  return [...byGroup.values()].map(points => clusterFromPoints(points, points[0]?.place.financialGroup ? "group" : "place"))
}

function clusterFromPoints(points: PlottedPlace[], level: PlaceCluster["level"]): PlaceCluster {
  const stablePoints = points.toSorted((a, b) => a.place.id.localeCompare(b.place.id))
  const center = centerOf(stablePoints)
  const places = stablePoints.map(point => point.place)
  const financialGroup = places[0]?.financialGroup
  return {
    id: places.map(place => place.id).join(":"),
    places,
    x: center.x,
    y: center.y,
    totalSpend: places.reduce((sum, place) => sum + (place.stats.totalSpend ?? 0), 0),
    fallbackWeight: places.reduce((sum, place) => sum + place.weight, 0),
    label: level === "group" && financialGroup
      ? financialGroup.name
      : level === "neighborhood"
        ? `${places.length} nearby places`
        : places[0]?.name ?? "Place",
    level,
    placeType: dominantPlaceType(places),
  }
}

function centerOf(points: PlottedPlace[]) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by)
}

export function markerSize(totalSpend: number, fallbackWeight: number) {
  if (totalSpend <= 0) {
    return Math.max(13, Math.min(42, 12 + Math.sqrt(Math.max(fallbackWeight, 1)) * 2.4))
  }
  return Math.max(16, Math.min(62, 12 + Math.log10(totalSpend + 1) * 14))
}

export function cssPixel(value: number) {
  return `${Math.round(value * 1000) / 1000}px`
}

function dominantPlaceType(places: PlaceMapItem[]) {
  const counts = new Map<string, number>()
  for (const place of places) {
    const key = normalizePlaceType(place.placeType)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
}

function normalizePlaceType(value?: string) {
  return value?.trim().toLowerCase().replaceAll(/\s+/g, "_")
}
