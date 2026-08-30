import { cameraBounds, clampCamera, type Camera, type MapBounds } from "./map-computation"

export type CoordinateRegionLike = {
  center: { latitude: number; longitude: number }
  span: { latitudeDelta: number; longitudeDelta: number }
}

const TILE_SIZE = 256

export function regionForCamera(camera: Camera, width: number, height: number): CoordinateRegionLike {
  const safeWidth = Math.max(width, 1)
  const safeHeight = Math.max(height, 1)
  const bounds = cameraBounds(camera, safeWidth, safeHeight)
  return {
    center: { latitude: camera.lat, longitude: camera.lng },
    span: {
      latitudeDelta: Math.max(0.00001, bounds.north - bounds.south),
      longitudeDelta: Math.max(0.00001, longitudeSpan(bounds)),
    },
  }
}

export function cameraForRegion(region: CoordinateRegionLike, width: number): Camera {
  const safeWidth = Math.max(width, 1)
  const longitudeDelta = Math.max(region.span.longitudeDelta, 0.00001)
  const zoom = Math.log2((360 * safeWidth) / (TILE_SIZE * longitudeDelta))
  return clampCamera({
    lat: region.center.latitude,
    lng: region.center.longitude,
    zoom,
  })
}

export function boundsForRegion(region: CoordinateRegionLike): MapBounds {
  const latitudeRadius = region.span.latitudeDelta / 2
  const longitudeRadius = region.span.longitudeDelta / 2
  return {
    north: Math.min(85, region.center.latitude + latitudeRadius),
    south: Math.max(-85, region.center.latitude - latitudeRadius),
    east: normalizeLongitude(region.center.longitude + longitudeRadius),
    west: normalizeLongitude(region.center.longitude - longitudeRadius),
  }
}

export function cameraFromParams(params: URLSearchParams): Camera | null {
  if (!params.has("lat") || !params.has("lng") || !params.has("z")) return null
  const lat = Number(params.get("lat"))
  const lng = Number(params.get("lng"))
  const zoom = Number(params.get("z"))
  if (![lat, lng, zoom].every(Number.isFinite)) return null
  return clampCamera({ lat, lng, zoom })
}

function longitudeSpan(bounds: MapBounds) {
  return bounds.west <= bounds.east
    ? bounds.east - bounds.west
    : 360 - bounds.west + bounds.east
}

function normalizeLongitude(longitude: number) {
  return ((longitude + 540) % 360) - 180
}
