"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { EmptyState } from "@life-os/ui"
import { LayerPanel, type LayerConfig, type LayerId } from "@/components/map/LayerPanel"

type PlaceMapItem = {
  id: string
  name: string
  latitude?: number
  longitude?: number
  address?: string
  googlePlaceId?: string
  placeType?: string
  favorite?: boolean
  stats: {
    visitCount: number
    photoCount: number
    personCount: number
    groupCount: number
    noteCount: number
    planCount: number
    totalSpend?: number
    lastVisitAt?: string
  }
  weight: number
  financialGroup?: {
    id: string
    name: string
    groupType: string
    relationshipType: string
  }
}

type UnresolvedVisitMapItem = {
  id: string
  latitude: number
  longitude: number
  placeName?: string
  placeAddress?: string
  startedAt: string
  confidence: number
  aiEnrichment?: {
    placeName: string
    category: string
    confidence: number
    reasoning: string
  }
}

type InteractionLayerItem = {
  placeId: string
  interactionCount: number
  latestAt?: string
  people: Array<{ id: string; name: string }>
  interactions: Array<{
    id: string
    type: string
    summary?: string
    timestamp: string
    personName?: string
  }>
}

type FinanceLayerItem = {
  placeId: string
  transactionCount: number
  totalAmount: number
  transactions: Array<{ merchant: string; amount: number; date: string }>
}

type PhotoLayerItem = {
  placeId: string
  photoCount: number
  googlePhotosDeeplink: string
}

type MapLayerData = {
  unresolvedVisits: UnresolvedVisitMapItem[]
  interactions: InteractionLayerItem[]
  finance: FinanceLayerItem[]
  photos: PhotoLayerItem[]
}

type FilterKey = "all" | "favorites" | "photos" | "people" | "notes"
type PlottedPlace = { place: PlaceMapItem; x: number; y: number }
type CoordinateSource = { id: string; latitude?: number; longitude?: number }
type PlottedCoordinate<T> = { item: T; x: number; y: number }
type Tile = { key: string; src: string; left: number; top: number }
type MapViewport = { tiles: Tile[]; points: PlottedPlace[]; centerLabel: string; tileZoom?: number; topLeft?: { x: number; y: number }; width: number; height: number }
type PlaceCluster = {
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

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "favorites", label: "Favorites" },
  { key: "photos", label: "Has photos" },
  { key: "people", label: "Has people" },
  { key: "notes", label: "Has notes" },
]

const ALL_LAYER_IDS: LayerId[] = ["location", "finance", "photos", "interactions", "enrichment"]

export default function PlacesClient({ places, layers }: { places: PlaceMapItem[]; layers: MapLayerData }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [filter, setFilter] = useState<FilterKey>("all")
  const [selectedId, setSelectedId] = useState<string | null>(places[0]?.id ?? null)
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const activeLayerIds = useMemo(() => layersFromParam(searchParams.get("layers")), [searchParams])

  const filtered = useMemo(() => places.filter(place => {
    if (filter === "favorites") return place.favorite
    if (filter === "photos") return place.stats.photoCount > 0
    if (filter === "people") return place.stats.personCount > 0
    if (filter === "notes") return place.stats.noteCount > 0
    return true
  }), [filter, places])

  const selected = filtered.find(place => place.id === selectedId) ?? filtered[0] ?? null
  const selectedVisit = layers.unresolvedVisits.find(visit => visit.id === selectedVisitId) ?? null
  const locationActive = activeLayerIds.has("location")
  const interactionActive = activeLayerIds.has("interactions")
  const financeActive = activeLayerIds.has("finance")
  const photosActive = activeLayerIds.has("photos")
  const enrichmentActive = activeLayerIds.has("enrichment")
  const viewportSources = locationActive ? [...filtered, ...layers.unresolvedVisits] : filtered
  const viewport = useMemo(() => buildMapViewport(filtered, zoom, viewportSources), [filtered, zoom, viewportSources])
  const plotted = viewport.points.length ? viewport.points : plotPlaces(filtered)
  const clusters = useMemo(() => clusterPlaces(plotted, zoom), [plotted, zoom])
  const unresolvedPoints = useMemo(() => projectCoordinates(layers.unresolvedVisits, viewport), [layers.unresolvedVisits, viewport])
  const interactionsByPlace = useMemo(() => new Map(layers.interactions.map(item => [item.placeId, item])), [layers.interactions])
  const financeByPlace = useMemo(() => new Map(layers.finance.map(item => [item.placeId, item])), [layers.finance])
  const photosByPlace = useMemo(() => new Map(layers.photos.map(item => [item.placeId, item])), [layers.photos])
  const layerConfigs = useMemo<LayerConfig[]>(() => [
    { id: "location", label: "Location", icon: "L", color: "#3778c2", count: filtered.length + layers.unresolvedVisits.length, active: locationActive },
    { id: "finance", label: "Finance", icon: "$", color: "#3f8f5f", count: layers.finance.length, active: financeActive },
    { id: "photos", label: "Photos", icon: "Ph", color: "#7657b7", count: layers.photos.length, active: photosActive },
    { id: "interactions", label: "Interactions", icon: "In", color: "#d4742f", count: layers.interactions.reduce((sum, item) => sum + item.interactionCount, 0), active: interactionActive },
    { id: "enrichment", label: "AI enrichment", icon: "AI", color: "#d2a321", count: layers.unresolvedVisits.filter(visit => visit.aiEnrichment).length, active: enrichmentActive },
  ], [filtered.length, layers, locationActive, financeActive, photosActive, interactionActive, enrichmentActive])
  const zoomLevelLabel = zoom <= 1 ? "Group spend" : zoom < 4 ? "Neighborhood spend" : "Place spend"

  const toggleLayer = (id: LayerId) => {
    const next = new Set(activeLayerIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    const params = new URLSearchParams(searchParams.toString())
    params.set("layers", ALL_LAYER_IDS.filter(layerId => next.has(layerId)).join(","))
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  return (
    <div style={{ maxWidth: "1180px", margin: "0 auto", padding: "28px 24px 40px" }}>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", marginBottom: "18px", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", fontWeight: 600, margin: 0, color: "var(--ink)" }}>Places</h1>
          <div style={{ color: "var(--ink-3)", fontSize: "12px", marginTop: "4px" }}>
            {places.length.toLocaleString()} {places.length === 1 ? "place" : "places"}
            {totalSpend(filtered) > 0 && ` · ${money(totalSpend(filtered))} recorded spend`}
            {` · ${zoomLevelLabel}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          {FILTERS.map(item => (
            <button
              key={item.key}
              onClick={() => { setFilter(item.key); setSelectedId(null); setSelectedVisitId(null) }}
              style={{
                padding: "6px 11px",
                borderRadius: "7px",
                border: `1px solid ${filter === item.key ? "var(--accent)" : "var(--border)"}`,
                background: filter === item.key ? "var(--accent-soft)" : "transparent",
                color: filter === item.key ? "var(--accent)" : "var(--ink-3)",
                fontFamily: "inherit",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
          <Link
            href="/places/import"
            style={{
              padding: "7px 12px",
              borderRadius: "7px",
              border: "1px solid var(--accent)",
              background: "var(--accent)",
              color: "#fff",
              fontSize: "11px",
              textDecoration: "none",
            }}
          >
            Import
          </Link>
        </div>
      </header>

      {places.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px" }}>
          <EmptyState
            icon="◎"
            title="No places yet"
            subtitle="Import location history or create your first place to start building your private map."
          />
        </div>
      ) : (
        <div className="places-map-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: "18px", alignItems: "stretch" }}>
          <section
            aria-label="Places map"
            style={{
              minHeight: "620px",
              position: "relative",
              overflow: "hidden",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              background: "linear-gradient(180deg, #f8f6f0 0%, #ede9df 100%)",
            }}
          >
            {viewport.tiles.map(tile => (
              <img
                key={tile.key}
                src={tile.src}
                alt=""
                width={256}
                height={256}
                draggable={false}
                style={{
                  position: "absolute",
                  left: `${tile.left}px`,
                  top: `${tile.top}px`,
                  width: "256px",
                  height: "256px",
                  userSelect: "none",
                }}
              />
            ))}
            <div style={{ position: "absolute", inset: 0, background: "rgba(250, 248, 244, 0.1)" }} />
            <LayerPanel layers={layerConfigs} onToggle={toggleLayer} />
            <div style={{
              position: "absolute",
              top: "14px",
              left: "14px",
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 10px",
              border: "1px solid var(--border)",
              borderRadius: "9px",
              background: "rgba(250, 248, 244, 0.9)",
              boxShadow: "0 10px 30px rgba(26, 24, 20, 0.08)",
            }}>
              <button
                aria-label="Zoom out"
                onClick={() => setZoom(value => Math.max(0, value - 1))}
                style={zoomButtonStyle}
              >
                −
              </button>
              <input
                aria-label="Map zoom"
                type="range"
                min={0}
                max={4}
                step={1}
                value={zoom}
                onChange={event => setZoom(Number(event.target.value))}
                style={{ width: "108px", accentColor: "var(--accent)" }}
              />
              <button
                aria-label="Zoom in"
                onClick={() => setZoom(value => Math.min(4, value + 1))}
                style={zoomButtonStyle}
              >
                +
              </button>
            </div>
            <div style={{
              position: "absolute",
              left: "14px",
              bottom: "14px",
              zIndex: 2,
              padding: "7px 10px",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              background: "rgba(250, 248, 244, 0.92)",
              color: "var(--ink-3)",
              fontSize: "10px",
            }}>
              {viewport.centerLabel} · OpenStreetMap
            </div>
            {filtered.length === 0 && (!locationActive || layers.unresolvedVisits.length === 0) ? (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <EmptyState icon="○" title="No matching places" subtitle="Try a different filter." />
              </div>
            ) : (
              locationActive && clusters.map(cluster => {
                const single = cluster.level === "place" && cluster.places.length === 1 ? cluster.places[0] : null
                const selectedMarker = single ? selected?.id === single.id : cluster.places.some(place => place.id === selected?.id)
                const size = markerSize(cluster.totalSpend, cluster.fallbackWeight)
                const label = single ? single.name : cluster.label
                const color = placeTypeColor(cluster.placeType)
                const interaction = single ? interactionsByPlace.get(single.id) : undefined
                const finance = single ? financeByPlace.get(single.id) : undefined
                const photo = single ? photosByPlace.get(single.id) : undefined
                return (
                  <button
                    key={cluster.id}
                    aria-label={label}
                    onClick={() => {
                      if (cluster.places.length > 1 && zoom < 4) {
                        setZoom(value => Math.min(4, value + 1))
                      }
                      setSelectedId(cluster.places[0]?.id ?? null)
                      setSelectedVisitId(null)
                    }}
                    style={{
                      position: "absolute",
                      left: `${cluster.x}px`,
                      top: `${cluster.y}px`,
                      width: `${size}px`,
                      height: `${size}px`,
                      transform: "translate(-50%, -50%)",
                      borderRadius: "50%",
                      border: selectedMarker ? "2px solid var(--ink)" : "1px solid #ffffff",
                      background: selectedMarker ? "var(--accent)" : color,
                      boxShadow: selectedMarker ? `0 0 0 8px ${color}2b` : "0 8px 20px rgba(26, 24, 20, 0.16)",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: cluster.level !== "place" ? "11px" : 0,
                      fontWeight: 700,
                      transition: "left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease, box-shadow 180ms ease",
                    }}
                    title={`${label}${cluster.totalSpend > 0 ? ` · ${money(cluster.totalSpend)}` : " · no spend yet"}`}
                  >
                    {cluster.level === "group" ? shortGroupLabel(cluster.label) : cluster.level === "neighborhood" ? cluster.places.length : ""}
                    {interactionActive && interaction ? <PinBadge label={String(interaction.interactionCount)} color="#d4742f" x={size - 8} y={-6} /> : null}
                    {financeActive && finance ? <PinBadge label="$" color="#3f8f5f" x={-8} y={size - 10} /> : null}
                    {photosActive && photo ? <PhotoLayerPin item={photo} x={size - 8} y={size - 10} /> : null}
                  </button>
                )
              })
            )}
            {locationActive && unresolvedPoints.map(point => (
              <button
                key={point.item.id}
                type="button"
                aria-label="Unresolved visit"
                onClick={() => {
                  setSelectedVisitId(point.item.id)
                  setSelectedId(null)
                }}
                style={{
                  position: "absolute",
                  left: `${point.x}px`,
                  top: `${point.y}px`,
                  width: "24px",
                  height: "24px",
                  transform: "translate(-50%, -50%)",
                  borderRadius: "50%",
                  border: selectedVisitId === point.item.id ? "2px solid var(--ink)" : "1px solid #fff",
                  background: "rgba(55, 120, 194, 0.52)",
                  color: "#fff",
                  boxShadow: "0 8px 18px rgba(26, 24, 20, 0.14)",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: 700,
                }}
                title={unresolvedVisitTitle(point.item)}
              >
                ?
                {enrichmentActive && point.item.aiEnrichment ? (
                  <PinBadge label="" color={enrichmentColor(point.item.aiEnrichment.confidence)} x={15} y={-5} />
                ) : null}
              </button>
            ))}
          </section>

          <aside style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {selectedVisit ? (
              <UnresolvedVisitPreview visit={selectedVisit} />
            ) : selected ? (
              <PlacePreview place={selected} />
            ) : (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px" }}>
                <EmptyState icon="◎" title="Select a place" subtitle="Markers open a preview before you jump into the full memory page." />
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "360px", overflow: "auto" }}>
              {filtered.slice(0, 250).map(place => (
                <button
                  key={place.id}
                  onClick={() => { setSelectedId(place.id); setSelectedVisitId(null) }}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    border: `1px solid ${selected?.id === place.id ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: "8px",
                    background: selected?.id === place.id ? "var(--accent-soft)" : "var(--surface)",
                    color: "var(--ink)",
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: 600 }}>{place.favorite ? "★ " : ""}{place.name}</div>
                  <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "2px" }}>
                    {place.stats.visitCount} visits · {place.stats.personCount} people{place.stats.totalSpend ? ` · ${money(place.stats.totalSpend)}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function PlacePreview({ place }: { place: PlaceMapItem }) {
  const coordinateLabel = coordinatesLabel(place)
  const googleMapsHref = mapHref(place)
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ height: "130px", background: "linear-gradient(135deg, #e9dfcf, #cdd4cf)", borderBottom: "1px solid var(--border)", position: "relative" }}>
        <div style={{ position: "absolute", left: "18px", bottom: "14px", color: "#fff", textShadow: "0 1px 14px rgba(0,0,0,0.35)", fontSize: "24px" }}>◎</div>
      </div>
      <div style={{ padding: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: 0 }}>{place.name}</h2>
        <div style={{ fontSize: "11px", color: "var(--ink-3)", marginTop: "4px" }}>
          {[place.address, labelize(place.placeType)].filter(Boolean).join(" · ") || "No street address in export"}
        </div>
        <div style={{ display: "grid", gap: "6px", marginTop: "12px", fontSize: "11px", color: "var(--ink-3)" }}>
          <DetailRow label="Address" value={place.address || "Google did not include a text address"} />
          <DetailRow label="Coordinates" value={coordinateLabel || "No coordinates"} href={googleMapsHref} />
          <DetailRow label="Google ID" value={place.googlePlaceId || "None"} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginTop: "14px" }}>
          <MiniStat label="Visits" value={place.stats.visitCount} />
          <MiniStat label="Photos" value={place.stats.photoCount} />
          <MiniStat label="Spend" value={place.stats.totalSpend ? money(place.stats.totalSpend) : "$0"} />
        </div>
        <div style={{ fontSize: "11px", color: "var(--ink-4)", marginTop: "12px" }}>
          Last visit: {formatDate(place.stats.lastVisitAt)}
        </div>
        <Link href={`/places/${place.id}`} style={{
          marginTop: "14px",
          display: "inline-flex",
          padding: "8px 14px",
          background: "var(--accent)",
          color: "#fff",
          borderRadius: "7px",
          textDecoration: "none",
          fontSize: "11px",
        }}>
          Open
        </Link>
      </div>
    </div>
  )
}

function UnresolvedVisitPreview({ visit }: { visit: UnresolvedVisitMapItem }) {
  const coordinateLabel = coordinatesText(visit.latitude, visit.longitude)
  const googleMapsHref = `https://www.google.com/maps/search/?api=1&query=${visit.latitude},${visit.longitude}`
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ padding: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: 0 }}>Unresolved visit</h2>
        <div style={{ fontSize: "11px", color: "var(--ink-3)", marginTop: "4px" }}>
          {formatDate(visit.startedAt)} · {Math.round(visit.confidence)}% import confidence
        </div>
        <div style={{ display: "grid", gap: "6px", marginTop: "12px", fontSize: "11px", color: "var(--ink-3)" }}>
          <DetailRow label="Address" value={visit.placeAddress || "No text address in export"} />
          <DetailRow label="Coordinates" value={coordinateLabel} href={googleMapsHref} />
        </div>
        {visit.aiEnrichment ? (
          <div style={{ marginTop: "14px", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px", background: "var(--bg)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
              <div style={{ fontSize: "12px", fontWeight: 700 }}>{visit.aiEnrichment.placeName}</div>
              <div style={{ fontSize: "10px", color: enrichmentColor(visit.aiEnrichment.confidence), fontWeight: 700 }}>
                {Math.round(visit.aiEnrichment.confidence * 100)}%
              </div>
            </div>
            <div style={{ fontSize: "10px", color: "var(--ink-3)", marginTop: "3px" }}>{labelize(visit.aiEnrichment.category)}</div>
            <div style={{ fontSize: "11px", color: "var(--ink-2)", marginTop: "8px" }}>{visit.aiEnrichment.reasoning}</div>
          </div>
        ) : (
          <div style={{ marginTop: "14px", fontSize: "11px", color: "var(--ink-4)" }}>
            No AI enrichment result yet.
          </div>
        )}
      </div>
    </div>
  )
}

function PinBadge({ label, color, x, y }: { label: string; color: string; x: number; y: number }) {
  return (
    <span style={{
      position: "absolute",
      left: `${x}px`,
      top: `${y}px`,
      minWidth: "16px",
      height: "16px",
      borderRadius: "999px",
      border: "1px solid #fff",
      background: color,
      color: "#fff",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "9px",
      lineHeight: 1,
      fontWeight: 700,
    }}>
      {label}
    </span>
  )
}

function PhotoLayerPin({ item, x, y }: { item: PhotoLayerItem; x: number; y: number }) {
  return (
    <span
      role="link"
      title={`${item.photoCount} photos`}
      onClick={event => {
        event.stopPropagation()
        window.open(item.googlePhotosDeeplink, "_blank", "noreferrer")
      }}
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        minWidth: "18px",
        height: "16px",
        borderRadius: "999px",
        border: "1px solid #fff",
        background: "#7657b7",
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "9px",
        fontWeight: 700,
      }}
    >
      {item.photoCount}
    </span>
  )
}

function DetailRow({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = href ? (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>{value}</a>
  ) : value
  return (
    <div style={{ display: "grid", gridTemplateColumns: "76px minmax(0, 1fr)", gap: "8px" }}>
      <span style={{ color: "var(--ink-4)" }}>{label}</span>
      <span style={{ overflowWrap: "anywhere" }}>{content}</span>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "8px", background: "var(--bg)" }}>
      <div style={{ fontSize: "15px", color: "var(--ink)", fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: "9px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
    </div>
  )
}

function plotPlaces(places: PlaceMapItem[]): PlottedPlace[] {
  const viewport = buildMapViewport(places, 1, places)
  if (viewport.points.length) return viewport.points

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

function buildMapViewport(places: PlaceMapItem[], zoom: number, sources: CoordinateSource[]): MapViewport {
  const width = 820
  const height = 620
  const withCoordinates = sources.filter(item => typeof item.latitude === "number" && typeof item.longitude === "number")
  if (!withCoordinates.length) {
    return {
      tiles: [],
      points: [],
      centerLabel: "No coordinates yet",
      width,
      height,
    }
  }

  const centerLat = withCoordinates.reduce((sum, place) => sum + place.latitude!, 0) / withCoordinates.length
  const centerLng = withCoordinates.reduce((sum, place) => sum + place.longitude!, 0) / withCoordinates.length
  const tileZoom = fitTileZoom(withCoordinates, width, height, zoom)
  const center = project(centerLat, centerLng, tileZoom)
  const topLeft = { x: center.x - width / 2, y: center.y - height / 2 }
  const startX = Math.floor(topLeft.x / 256)
  const endX = Math.floor((topLeft.x + width) / 256)
  const startY = Math.floor(topLeft.y / 256)
  const endY = Math.floor((topLeft.y + height) / 256)
  const tiles: Tile[] = []

  for (let x = startX; x <= endX; x++) {
    for (let y = startY; y <= endY; y++) {
      tiles.push({
        key: `${tileZoom}:${x}:${y}`,
        src: `https://tile.openstreetmap.org/${tileZoom}/${x}/${y}.png`,
        left: x * 256 - topLeft.x,
        top: y * 256 - topLeft.y,
      })
    }
  }

  return {
    tiles,
    points: places.map((place, index) => {
      if (typeof place.latitude !== "number" || typeof place.longitude !== "number") {
        return { place, x: 24 + (index % 4) * 22, y: height - 46 }
      }
      const point = project(place.latitude, place.longitude, tileZoom)
      return { place, x: point.x - topLeft.x, y: point.y - topLeft.y }
    }),
    centerLabel: coordinatesText(centerLat, centerLng),
    tileZoom,
    topLeft,
    width,
    height,
  }
}

function projectCoordinates<T extends CoordinateSource>(items: T[], viewport: MapViewport): Array<PlottedCoordinate<T>> {
  if (viewport.tileZoom === undefined || !viewport.topLeft) {
    return items.map((item, index) => ({ item, x: 96 + (index % 5) * 40, y: viewport.height - 72 }))
  }
  return items.flatMap((item, index) => {
    if (typeof item.latitude !== "number" || typeof item.longitude !== "number") {
      return [{ item, x: 96 + (index % 5) * 40, y: viewport.height - 72 }]
    }
    const point = project(item.latitude, item.longitude, viewport.tileZoom!)
    return [{ item, x: point.x - viewport.topLeft!.x, y: point.y - viewport.topLeft!.y }]
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

function clusterPlaces(points: PlottedPlace[], zoom: number): PlaceCluster[] {
  if (zoom <= 1) return clusterByFinancialGroup(points)
  const radius = clusterRadiusForZoom(zoom)
  if (radius === 0) return points.map(point => clusterFromPoints([point], "place"))

  const clusters: PlottedPlace[][] = []
  for (const point of points) {
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

function clusterRadiusForZoom(zoom: number) {
  if (zoom >= 4) return 0
  return Math.max(5, 24 - zoom * 5)
}

function clusterByFinancialGroup(points: PlottedPlace[]) {
  const byGroup = new Map<string, PlottedPlace[]>()
  for (const point of points) {
    const group = point.place.financialGroup
    const key = group ? `group:${group.id}` : `place:${point.place.id}`
    byGroup.set(key, [...(byGroup.get(key) ?? []), point])
  }
  return [...byGroup.values()].map(points => clusterFromPoints(points, points[0]?.place.financialGroup ? "group" : "place"))
}

function clusterFromPoints(points: PlottedPlace[], level: PlaceCluster["level"]): PlaceCluster {
  const center = centerOf(points)
  const places = points.map(point => point.place)
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

function markerSize(totalSpend: number, fallbackWeight: number) {
  if (totalSpend <= 0) {
    return Math.max(13, Math.min(42, 12 + Math.sqrt(Math.max(fallbackWeight, 1)) * 2.4))
  }
  return Math.max(16, Math.min(62, 12 + Math.log10(totalSpend + 1) * 14))
}

function formatDate(value?: string) {
  if (!value) return "Never"
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
}

function coordinatesLabel(place: PlaceMapItem) {
  if (typeof place.latitude !== "number" || typeof place.longitude !== "number") return ""
  return coordinatesText(place.latitude, place.longitude)
}

function coordinatesText(latitude: number, longitude: number) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
}

function mapHref(place: PlaceMapItem) {
  if (typeof place.latitude !== "number" || typeof place.longitude !== "number") return undefined
  return `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`
}

function layersFromParam(value: string | null) {
  if (!value) return new Set<LayerId>(ALL_LAYER_IDS)
  const requested = value.split(",").map(item => item.trim()).filter((item): item is LayerId =>
    ALL_LAYER_IDS.includes(item as LayerId)
  )
  return new Set<LayerId>(requested.length ? requested : ALL_LAYER_IDS)
}

function labelize(value?: string) {
  if (!value) return ""
  return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase())
}

function unresolvedVisitTitle(visit: UnresolvedVisitMapItem) {
  if (!visit.aiEnrichment) return `Unresolved visit · ${Math.round(visit.confidence)}% import confidence`
  return `${visit.aiEnrichment.placeName} · ${Math.round(visit.aiEnrichment.confidence * 100)}% AI confidence`
}

function enrichmentColor(confidence: number) {
  if (confidence >= 0.75) return "#3f8f5f"
  if (confidence >= 0.45) return "#d2a321"
  return "#b9475a"
}

function totalSpend(places: PlaceMapItem[]) {
  return places.reduce((sum, place) => sum + (place.stats.totalSpend ?? 0), 0)
}

function money(value: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
}

function shortGroupLabel(label: string) {
  return label.split(/\s+/).map(word => word[0]).join("").slice(0, 3).toUpperCase()
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

function placeTypeColor(placeType?: string) {
  const palette: Record<string, string> = {
    cafe: "#c4572a",
    coffee: "#c4572a",
    restaurant: "#b85f35",
    bar: "#6f5ca8",
    store: "#3f7f6b",
    shop: "#3f7f6b",
    grocery: "#5f8b4c",
    home: "#4f6f88",
    office: "#8a6f3d",
    gym: "#b9475a",
    hotel: "#7b6a58",
    airport: "#4f789e",
    park: "#5f8b4c",
  }
  if (!placeType) return "#7b8a84"
  return palette[placeType] ?? hashColor(placeType)
}

function hashColor(value: string) {
  const colors = ["#c4572a", "#3f7f6b", "#6f5ca8", "#8a6f3d", "#4f789e", "#b9475a", "#5f8b4c"]
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  return colors[hash % colors.length]
}

const zoomButtonStyle = {
  width: "24px",
  height: "24px",
  borderRadius: "50%",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--ink)",
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1,
}
