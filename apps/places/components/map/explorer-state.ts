export type PlacesMode = "explore" | "review"
export type PlacesView = "split" | "map" | "list"
export type PlacesSort = "recent" | "visits" | "name"
export type VisitRecency = "any" | "30d" | "1y" | "older"
export type FirstVisitRange = "any" | "1y" | "older"
export type SpatialBounds = { north: number; south: number; east: number; west: number }

export type ExplorerPlace = {
  id: string
  name: string
  address?: string
  latitude?: number
  longitude?: number
  placeType?: string
  favorite?: boolean
  stats: {
    visitCount: number
    photoCount: number
    personCount: number
    noteCount: number
    planCount: number
    totalSpend?: number
    firstVisitAt?: string
    lastVisitAt?: string
  }
}

export type PlacesExplorerState = {
  mode: PlacesMode
  view: PlacesView
  query: string
  sort: PlacesSort
  type: string
  recency: VisitRecency
  firstVisited: FirstVisitRange
  minVisits: number
  bounds: SpatialBounds | null
  selectedId: string | null
}

export const DEFAULT_EXPLORER_STATE: PlacesExplorerState = {
  mode: "explore",
  view: "split",
  query: "",
  sort: "recent",
  type: "all",
  recency: "any",
  firstVisited: "any",
  minVisits: 0,
  bounds: null,
  selectedId: null,
}

export function explorerStateFromParams(params: URLSearchParams): PlacesExplorerState {
  return {
    mode: enumParam(params.get("mode"), ["explore", "review"], DEFAULT_EXPLORER_STATE.mode),
    view: enumParam(params.get("view"), ["split", "map", "list"], DEFAULT_EXPLORER_STATE.view),
    query: params.get("q")?.trim() ?? "",
    sort: enumParam(params.get("sort"), ["recent", "visits", "name"], DEFAULT_EXPLORER_STATE.sort),
    type: params.get("type")?.trim() || "all",
    recency: enumParam(params.get("recency"), ["any", "30d", "1y", "older"], DEFAULT_EXPLORER_STATE.recency),
    firstVisited: enumParam(params.get("first"), ["any", "1y", "older"], DEFAULT_EXPLORER_STATE.firstVisited),
    minVisits: positiveInteger(params.get("minVisits")),
    bounds: boundsParam(params.get("bounds")),
    selectedId: params.get("place")?.trim() || null,
  }
}

export function updateExplorerParams(
  current: URLSearchParams,
  patch: Partial<PlacesExplorerState>,
) {
  const next = new URLSearchParams(current)
  const state = { ...explorerStateFromParams(current), ...patch }
  setOrDelete(next, "mode", state.mode, DEFAULT_EXPLORER_STATE.mode)
  setOrDelete(next, "view", state.view, DEFAULT_EXPLORER_STATE.view)
  setOrDelete(next, "q", state.query.trim(), "")
  setOrDelete(next, "sort", state.sort, DEFAULT_EXPLORER_STATE.sort)
  setOrDelete(next, "type", state.type, "all")
  setOrDelete(next, "recency", state.recency, DEFAULT_EXPLORER_STATE.recency)
  setOrDelete(next, "first", state.firstVisited, DEFAULT_EXPLORER_STATE.firstVisited)
  setOrDelete(next, "minVisits", state.minVisits ? String(state.minVisits) : "", "")
  setOrDelete(next, "bounds", serializeBounds(state.bounds), "")
  setOrDelete(next, "place", state.selectedId ?? "", "")
  return next
}

export function filterAndSortPlaces<T extends ExplorerPlace>(
  places: T[],
  state: PlacesExplorerState,
  now = new Date(),
) {
  const query = normalize(state.query)
  const cutoff30 = now.getTime() - 30 * 24 * 60 * 60 * 1000
  const cutoffYear = now.getTime() - 365 * 24 * 60 * 60 * 1000
  const filtered = places.filter(place => {
    if (query && !normalize(`${place.name} ${place.address ?? ""}`).includes(query)) return false
    if (state.type !== "all" && (place.placeType ?? "uncategorized") !== state.type) return false
    if (place.stats.visitCount < state.minVisits) return false
    if (state.bounds && !isInsideBounds(place, state.bounds)) return false
    const lastVisit = place.stats.lastVisitAt ? new Date(place.stats.lastVisitAt).getTime() : 0
    const firstVisit = place.stats.firstVisitAt ? new Date(place.stats.firstVisitAt).getTime() : 0
    if (state.recency === "30d" && lastVisit < cutoff30) return false
    if (state.recency === "1y" && lastVisit < cutoffYear) return false
    if (state.recency === "older" && (!lastVisit || lastVisit >= cutoffYear)) return false
    if (state.firstVisited === "1y" && firstVisit < cutoffYear) return false
    if (state.firstVisited === "older" && (!firstVisit || firstVisit >= cutoffYear)) return false
    return true
  })

  return filtered.toSorted((a, b) => {
    if (state.sort === "name") return a.name.localeCompare(b.name)
    if (state.sort === "visits") {
      return b.stats.visitCount - a.stats.visitCount || a.name.localeCompare(b.name)
    }
    return dateValue(b.stats.lastVisitAt) - dateValue(a.stats.lastVisitAt) || a.name.localeCompare(b.name)
  })
}

export function placeTypes(places: ExplorerPlace[]) {
  const counts = new Map<string, number>()
  for (const place of places) {
    const type = place.placeType ?? "uncategorized"
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .toSorted((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

export function sparseFilterCounts(places: ExplorerPlace[]) {
  return {
    favorites: places.filter(place => place.favorite).length,
    people: places.filter(place => place.stats.personCount > 0).length,
    photos: places.filter(place => place.stats.photoCount > 0).length,
    notes: places.filter(place => place.stats.noteCount > 0).length,
    spending: places.filter(place => (place.stats.totalSpend ?? 0) > 0).length,
    plans: places.filter(place => place.stats.planCount > 0).length,
  }
}

export function explorerFacetCounts(places: ExplorerPlace[], now = new Date()) {
  const cutoff30 = now.getTime() - 30 * 24 * 60 * 60 * 1000
  const cutoffYear = now.getTime() - 365 * 24 * 60 * 60 * 1000
  return {
    recency: {
      "30d": places.filter(place => dateValue(place.stats.lastVisitAt) >= cutoff30).length,
      "1y": places.filter(place => dateValue(place.stats.lastVisitAt) >= cutoffYear).length,
      older: places.filter(place => {
        const value = dateValue(place.stats.lastVisitAt)
        return value > 0 && value < cutoffYear
      }).length,
    },
    firstVisited: {
      "1y": places.filter(place => dateValue(place.stats.firstVisitAt) >= cutoffYear).length,
      older: places.filter(place => {
        const value = dateValue(place.stats.firstVisitAt)
        return value > 0 && value < cutoffYear
      }).length,
    },
    minVisits: {
      2: places.filter(place => place.stats.visitCount >= 2).length,
      5: places.filter(place => place.stats.visitCount >= 5).length,
      10: places.filter(place => place.stats.visitCount >= 10).length,
    },
  }
}

function enumParam<T extends string>(value: string | null, values: readonly T[], fallback: T) {
  return values.includes(value as T) ? value as T : fallback
}

function positiveInteger(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function setOrDelete(params: URLSearchParams, key: string, value: string, defaultValue: string) {
  if (!value || value === defaultValue) params.delete(key)
  else params.set(key, value)
}

function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase()
}

function dateValue(value?: string) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function boundsParam(value: string | null): SpatialBounds | null {
  if (!value) return null
  const [west, south, east, north] = value.split(",").map(Number)
  if (![west, south, east, north].every(Number.isFinite)) return null
  if (south < -85 || north > 85 || south > north || west < -180 || east > 180) return null
  return { west, south, east, north }
}

function serializeBounds(bounds: SpatialBounds | null) {
  if (!bounds) return ""
  return [bounds.west, bounds.south, bounds.east, bounds.north].map(value => value.toFixed(5)).join(",")
}

function isInsideBounds(place: ExplorerPlace, bounds: SpatialBounds) {
  if (typeof place.latitude !== "number" || typeof place.longitude !== "number") return false
  const withinLongitude = bounds.west <= bounds.east
    ? place.longitude >= bounds.west && place.longitude <= bounds.east
    : place.longitude >= bounds.west || place.longitude <= bounds.east
  return place.latitude >= bounds.south && place.latitude <= bounds.north && withinLongitude
}
