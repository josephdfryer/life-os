"use client"

import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { EmptyState } from "@life-os/ui"
import {
  LayerPanel,
  type EnrichmentConfig,
  type EnrichmentId,
  type MapViewConfig,
  type MapViewId,
} from "@/components/map/LayerPanel"
import { PlacePreview, UnresolvedVisitPreview } from "@/components/map/MapDetails"
import { PlacesToolbar } from "@/components/map/PlacesToolbar"
import { groupUnresolvedObservations } from "@/components/map/unresolved-groups"
import { useMapCamera } from "@/components/map/use-map-camera"
import { measureMapOperation } from "@/components/map/map-performance"
import {
  explorerStateFromParams,
  explorerFacetCounts,
  filterAndSortPlaces,
  placeTypes,
  sparseFilterCounts,
  updateExplorerParams,
  type PlacesExplorerState,
} from "@/components/map/explorer-state"
import {
  buildCameraViewport,
  cameraBounds,
  clusterPlaces,
  cssPixel,
  legacyZoomBucket,
  markerSize,
  plotPlaces,
  projectCoordinates,
  visibleClusterLabels,
} from "@/components/map/map-computation"
import { formatRoundedCurrency } from "@/lib/format"

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
    firstVisitAt?: string
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
  importJobId: string
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
}

type FinanceLayerItem = {
  placeId: string
  transactionCount: number
  totalAmount: number
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

export default function PlacesClient({ places, layers, errorMessage }: { places: PlaceMapItem[]; layers: MapLayerData; errorMessage?: string }) {
  const searchParams = useSearchParams()
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)
  const [tileLoadFailed, setTileLoadFailed] = useState(false)
  const explorerState = useMemo(() => explorerStateFromParams(new URLSearchParams(searchParams.toString())), [searchParams])
  const deferredQuery = useDeferredValue(explorerState.query)
  const effectiveExplorerState = useMemo(
    () => ({ ...explorerState, query: deferredQuery }),
    [explorerState, deferredQuery],
  )
  const activeMapView = mapViewFromParam(searchParams.get("mapView"), explorerState.mode)
  const activeEnrichments = useMemo(() => enrichmentsFromParam(searchParams.get("show")), [searchParams])
  const legendCollapsed = searchParams.get("legend") === "collapsed"
  const filtered = useMemo(
    () => filterAndSortPlaces(places, effectiveExplorerState),
    [effectiveExplorerState, places],
  )
  const selected = filtered.find(place => place.id === explorerState.selectedId) ?? null
  const selectedVisit = layers.unresolvedVisits.find(visit => visit.id === selectedVisitId) ?? null
  const peopleActive = activeEnrichments.has("people")
  const spendingActive = activeEnrichments.has("spending")
  const photosActive = activeEnrichments.has("photos")
  const unresolvedActive = activeMapView === "unresolved"
  const viewportSources = unresolvedActive ? layers.unresolvedVisits : filtered
  const { mapRef, mapSize, activeCamera, applyCamera, resetCamera } = useMapCamera(viewportSources, searchParams.toString())
  const viewport = useMemo(
    () => measureMapOperation(
      "viewport",
      filtered.length,
      () => buildCameraViewport(filtered, activeCamera, mapSize.width, mapSize.height),
    ),
    [filtered, activeCamera, mapSize],
  )
  const legacyZoom = legacyZoomBucket(viewport.tileZoom ?? 13)
  const plotted = viewport.points.length ? viewport.points : plotPlaces(filtered)
  const clusters = useMemo(
    () => measureMapOperation("clustering", plotted.length, () => clusterPlaces(plotted, legacyZoom)),
    [plotted, legacyZoom],
  )
  const visibleLabels = useMemo(
    () => visibleClusterLabels(clusters, selected?.id),
    [clusters, selected?.id],
  )
  const unresolvedPoints = useMemo(
    () => measureMapOperation(
      "coordinate_projection",
      layers.unresolvedVisits.length,
      () => projectCoordinates(layers.unresolvedVisits, viewport),
    ),
    [layers.unresolvedVisits, viewport],
  )
  const interactionsByPlace = useMemo(() => new Map(layers.interactions.map(item => [item.placeId, item])), [layers.interactions])
  const financeByPlace = useMemo(() => new Map(layers.finance.map(item => [item.placeId, item])), [layers.finance])
  const photosByPlace = useMemo(() => new Map(layers.photos.map(item => [item.placeId, item])), [layers.photos])
  const mapViews = useMemo<MapViewConfig[]>(() => [
    { id: "places", label: "Places", count: filtered.length },
    { id: "density", label: "Visit density", count: filtered.reduce((sum, place) => sum + place.stats.visitCount, 0) },
    { id: "unresolved", label: "Needs review", count: layers.unresolvedVisits.length },
  ], [filtered, layers.unresolvedVisits.length])
  const enrichmentConfigs = useMemo<EnrichmentConfig[]>(() => [
    layers.interactions.length
      ? { id: "people" as const, label: "People", color: "var(--map-people)", count: layers.interactions.reduce((sum, item) => sum + item.interactionCount, 0) }
      : null,
    layers.photos.length
      ? { id: "photos" as const, label: "Photos", color: "var(--map-photos)", count: layers.photos.reduce((sum, item) => sum + item.photoCount, 0) }
      : null,
    layers.finance.length
      ? { id: "spending" as const, label: "Spending", color: "var(--map-spending)", count: layers.finance.reduce((sum, item) => sum + item.transactionCount, 0) }
      : null,
  ].filter((item): item is EnrichmentConfig => item !== null), [layers.finance, layers.interactions, layers.photos])
  const typeOptions = useMemo(() => placeTypes(places), [places])
  const sparseCounts = useMemo(() => sparseFilterCounts(places), [places])
  const facetCounts = useMemo(() => explorerFacetCounts(places), [places])
  const unresolvedGroups = useMemo(
    () => groupUnresolvedObservations(layers.unresolvedVisits),
    [layers.unresolvedVisits],
  )

  const replaceParams = (nextParams: URLSearchParams, history: "push" | "replace" = "replace") => {
    const query = nextParams.toString()
    const url = query ? `?${query}` : window.location.pathname
    if (history === "push") window.history.pushState(null, "", url)
    else window.history.replaceState(null, "", url)
  }

  const updateExplorer = (patch: Partial<PlacesExplorerState>, history: "push" | "replace" = "replace") => {
    const params = updateExplorerParams(new URLSearchParams(searchParams.toString()), patch)
    replaceParams(params, history)
  }

  const setMapView = (view: MapViewId) => {
    const params = new URLSearchParams(searchParams.toString())
    if (view === "places") params.delete("mapView")
    else params.set("mapView", view)
    if (view === "unresolved") params.set("mode", "review")
    else if (explorerState.mode === "review") params.delete("mode")
    setSelectedVisitId(null)
    replaceParams(params, "push")
  }

  const toggleEnrichment = (id: EnrichmentId) => {
    const params = new URLSearchParams(searchParams.toString())
    const next = new Set(activeEnrichments)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (next.size) params.set("show", [...next].sort().join(","))
    else params.delete("show")
    replaceParams(params)
  }

  const setLegendCollapsed = (collapsed: boolean) => {
    const params = new URLSearchParams(searchParams.toString())
    if (collapsed) params.set("legend", "collapsed")
    else params.delete("legend")
    replaceParams(params)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (selectedVisitId) setSelectedVisitId(null)
      if (explorerState.selectedId) updateExplorer({ selectedId: null })
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // URL state changes intentionally refresh this lightweight handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explorerState.selectedId, selectedVisitId, searchParams])

  return (
    <div className="places-explorer">
      <PlacesToolbar
        state={explorerState}
        placeCount={places.length}
        filteredCount={filtered.length}
        totalSpend={totalSpend(filtered)}
        unresolvedCount={layers.unresolvedVisits.length}
        typeOptions={typeOptions}
        sparseCounts={sparseCounts}
        facetCounts={facetCounts}
        onUpdate={updateExplorer}
        onReviewToggle={() => setMapView(explorerState.mode === "review" ? "places" : "unresolved")}
      />

      {errorMessage ? (
        <div className="places-error-state" role="alert">
          <div>
            <strong>Places is temporarily unavailable</strong>
            <span>{errorMessage}</span>
          </div>
          <button type="button" onClick={() => window.location.reload()}>Try again</button>
        </div>
      ) : null}

      {places.length === 0 && !errorMessage ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-sm)" }}>
          <EmptyState
            icon="◎"
            title="No places yet"
            subtitle="Import location history or create your first place to start building your private map."
          />
        </div>
      ) : places.length ? (
        <div className={`places-map-layout places-view-${explorerState.view}`}>
          <section
            ref={mapRef}
            aria-label="Places map"
            aria-describedby="places-map-instructions"
            className="places-map-canvas"
            tabIndex={0}
            onKeyDown={event => {
              if (event.target !== event.currentTarget) return
              const panStep = event.shiftKey ? 180 : 72
              if (event.key === "ArrowLeft") applyCamera(current => ({ ...current, lng: current.lng - 360 / (2 ** current.zoom) * panStep / 256 }))
              else if (event.key === "ArrowRight") applyCamera(current => ({ ...current, lng: current.lng + 360 / (2 ** current.zoom) * panStep / 256 }))
              else if (event.key === "ArrowUp") applyCamera(current => ({ ...current, lat: current.lat + 180 / (2 ** current.zoom) * panStep / 256 }))
              else if (event.key === "ArrowDown") applyCamera(current => ({ ...current, lat: current.lat - 180 / (2 ** current.zoom) * panStep / 256 }))
              else if (event.key === "+" || event.key === "=") applyCamera(current => ({ ...current, zoom: current.zoom + 1 }))
              else if (event.key === "-") applyCamera(current => ({ ...current, zoom: current.zoom - 1 }))
              else return
              event.preventDefault()
            }}
            style={{
              minHeight: "620px",
              position: "relative",
              overflow: "hidden",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-sm)",
              background: "linear-gradient(180deg, #f8f6f0 0%, #ede9df 100%)",
            }}
          >
            <span id="places-map-instructions" className="places-sr-only">Use arrow keys to pan, plus and minus to zoom, and Shift with an arrow key to pan farther.</span>
            {viewport.tiles.map(tile => (
              <img
                key={tile.key}
                src={tile.src}
                alt=""
                width={256}
                height={256}
                draggable={false}
                onError={event => {
                  event.currentTarget.style.visibility = "hidden"
                  setTileLoadFailed(true)
                }}
                style={{
                  position: "absolute",
                  left: cssPixel(tile.left),
                  top: cssPixel(tile.top),
                  width: "256px",
                  height: "256px",
                  userSelect: "none",
                }}
              />
            ))}
            {tileLoadFailed ? (
              <div className="places-tile-warning" role="status">
                The street map could not fully load. Place markers and results still work.
              </div>
            ) : null}
            <div style={{ position: "absolute", inset: 0, background: "rgba(250, 248, 244, 0.1)" }} />
            <LayerPanel
              views={mapViews}
              activeView={activeMapView}
              enrichments={enrichmentConfigs}
              activeEnrichments={activeEnrichments}
              collapsed={legendCollapsed}
              onViewChange={setMapView}
              onEnrichmentToggle={toggleEnrichment}
              onCollapsedChange={setLegendCollapsed}
            />
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
                onClick={() => applyCamera(current => ({ ...current, zoom: current.zoom - 1 }))}
                style={zoomButtonStyle}
              >
                −
              </button>
              <input
                aria-label="Map zoom"
                type="range"
                min={3}
                max={19}
                step={0.5}
                value={activeCamera?.zoom ?? 13}
                onChange={event => applyCamera(current => ({ ...current, zoom: Number(event.target.value) }))}
                style={{ width: "108px", accentColor: "var(--cognac)" }}
              />
              <button
                aria-label="Zoom in"
                onClick={() => applyCamera(current => ({ ...current, zoom: current.zoom + 1 }))}
                style={zoomButtonStyle}
              >
                +
              </button>
              <button
                aria-label="Fit map to places"
                title="Fit to places"
                onClick={resetCamera}
                style={{ ...zoomButtonStyle, width: "auto", borderRadius: "12px", padding: "0 9px", fontSize: "11px" }}
              >
                Fit
              </button>
            </div>
            {!unresolvedActive && activeCamera ? (
              <button
                type="button"
                className="places-search-area"
                onClick={() => updateExplorer({
                  bounds: cameraBounds(activeCamera, mapSize.width, mapSize.height),
                  selectedId: null,
                }, "push")}
              >
                Search this area
              </button>
            ) : null}
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
              {viewport.centerLabel} · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>© OpenStreetMap contributors</a>
            </div>
            {!unresolvedActive && filtered.length === 0 ? (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <EmptyState
                  icon="○"
                  title="No matching places"
                  subtitle="Clear a filter or try a broader search."
                  action={(
                    <button
                      type="button"
                      className="places-empty-action"
                      onClick={() => updateExplorer({ query: "", type: "all", recency: "any", firstVisited: "any", minVisits: 0, bounds: null, selectedId: null })}
                    >
                      Clear filters
                    </button>
                  )}
                />
              </div>
            ) : unresolvedActive && layers.unresolvedVisits.length === 0 ? (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <EmptyState icon="✓" title="Nothing needs review" subtitle="All imported visits have been resolved or dismissed." />
              </div>
            ) : (
              !unresolvedActive && clusters.map(cluster => {
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
                    className="place-map-marker"
                    onClick={() => {
                      if (cluster.places.length > 1) {
                        const coords = cluster.places.filter(place => typeof place.latitude === "number" && typeof place.longitude === "number")
                        if (coords.length) {
                          const lat = coords.reduce((sum, place) => sum + place.latitude!, 0) / coords.length
                          const lng = coords.reduce((sum, place) => sum + place.longitude!, 0) / coords.length
                          applyCamera(current => ({ lat, lng, zoom: Math.min(19, current.zoom + 2) }))
                        }
                        return
                      }
                      updateExplorer({ selectedId: cluster.places[0]?.id ?? null }, "push")
                      setSelectedVisitId(null)
                    }}
                    style={{
                      position: "absolute",
                      left: cssPixel(cluster.x),
                      top: cssPixel(cluster.y),
                      width: cssPixel(size),
                      height: cssPixel(size),
                      transform: "translate(-50%, -50%)",
                      borderRadius: "50%",
                      border: selectedMarker ? "2px solid var(--ink)" : "1px solid #ffffff",
                      background: selectedMarker ? "var(--cognac)" : color,
                      boxShadow: selectedMarker ? `0 0 0 8px ${color}2b` : "0 8px 20px rgba(26, 24, 20, 0.16)",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: cluster.level !== "place" ? "11px" : 0,
                      fontWeight: 700,
                      transition: "width 180ms ease, height 180ms ease, box-shadow 180ms ease",
                    }}
                    title={`${label}${cluster.totalSpend > 0 ? ` · ${money(cluster.totalSpend)}` : " · no spend yet"}`}
                  >
                    {cluster.level === "group" ? shortGroupLabel(cluster.label) : cluster.level === "neighborhood" ? cluster.places.length : ""}
                    {single && visibleLabels.has(cluster.id) ? <span className="place-marker-label" aria-hidden="true">{single.name}</span> : null}
                    {peopleActive && interaction ? <PinBadge label={String(interaction.interactionCount)} color="var(--map-people)" x={size - 8} y={-6} /> : null}
                    {spendingActive && finance ? <PinBadge label="$" color="var(--map-spending)" x={-8} y={size - 10} /> : null}
                    {photosActive && photo ? <PhotoLayerPin item={photo} x={size - 8} y={size - 10} /> : null}
                  </button>
                )
              })
            )}
            {unresolvedActive && unresolvedPoints.map(point => (
              <button
                key={point.item.id}
                type="button"
                className="place-map-marker unresolved"
                aria-label="Unresolved visit"
                onClick={() => {
                  setSelectedVisitId(point.item.id)
                  updateExplorer({ selectedId: null })
                }}
                style={{
                  position: "absolute",
                  left: cssPixel(point.x),
                  top: cssPixel(point.y),
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
                {point.item.aiEnrichment ? (
                  <PinBadge label="" color={enrichmentColor(point.item.aiEnrichment.confidence)} x={15} y={-5} />
                ) : null}
              </button>
            ))}
            {selected && !unresolvedActive ? (
              <aside className="places-selection-drawer" aria-label={`${selected.name} preview`}>
                <button type="button" className="places-preview-close" aria-label="Close place preview" onClick={() => updateExplorer({ selectedId: null })}>×</button>
                <PlacePreview place={selected} returnQuery={searchParams.toString()} />
              </aside>
            ) : null}
          </section>

          <aside className="places-results-panel">
            {selectedVisit ? (
              <UnresolvedVisitPreview visit={selectedVisit} />
            ) : (
              <div className="places-selection-prompt">
                <EmptyState
                  icon={unresolvedActive ? "?" : "◎"}
                  title={unresolvedActive ? "Select a visit to review" : selected ? "Place selected" : "Select a place"}
                  subtitle={unresolvedActive ? "Choose a pending observation to inspect its source and suggested identity." : selected ? "Its preview is open over the map." : "Markers and results open a preview before you jump into the full memory page."}
                />
              </div>
            )}
            <div className="places-results-list" aria-label={unresolvedActive ? "Visits needing review" : "Place results"}>
              {unresolvedActive ? unresolvedGroups.map(group => {
                const visit = group.representative
                return (
                <button
                  key={group.id}
                  type="button"
                  className={`place-result-row${selectedVisitId === visit.id ? " is-selected" : ""}`}
                  onClick={() => {
                    setSelectedVisitId(visit.id)
                    updateExplorer({ selectedId: null })
                    applyCamera(current => ({ ...current, lat: visit.latitude, lng: visit.longitude, zoom: Math.max(current.zoom, 16) }))
                  }}
                >
                  <span className="place-result-name">{group.label}</span>
                  <span className="place-result-meta">
                    {group.observations.length > 1 ? `${group.observations.length} nearby visits · ` : ""}
                    {formatDateLabel(visit.startedAt)} · {Math.round(visit.confidence)}% import confidence
                  </span>
                  <span className="place-result-address">{visit.placeAddress ?? "No text address"}</span>
                </button>
                )
              }) : filtered.map(place => (
                <button
                  key={place.id}
                  type="button"
                  className={`place-result-row${selected?.id === place.id ? " is-selected" : ""}`}
                  onClick={() => {
                    updateExplorer({ selectedId: place.id }, "push")
                    setSelectedVisitId(null)
                    if (typeof place.latitude === "number" && typeof place.longitude === "number") {
                      applyCamera(current => ({ lat: place.latitude!, lng: place.longitude!, zoom: Math.max(current.zoom, 15) }))
                    }
                  }}
                >
                  <span className="place-result-name">{place.favorite ? "★ " : ""}{place.name}</span>
                  <span className="place-result-meta">
                    {place.stats.visitCount} {place.stats.visitCount === 1 ? "visit" : "visits"}
                    {place.stats.lastVisitAt ? ` · ${formatDateLabel(place.stats.lastVisitAt)}` : ""}
                    {place.stats.totalSpend ? ` · ${money(place.stats.totalSpend)}` : ""}
                  </span>
                  <span className="place-result-address">{[labelize(place.placeType), place.address].filter(Boolean).join(" · ") || "No address"}</span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}


function PinBadge({ label, color, x, y }: { label: string; color: string; x: number; y: number }) {
  return (
    <span style={{
      position: "absolute",
      left: cssPixel(x),
      top: cssPixel(y),
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
      title={`${item.photoCount} photos`}
      style={{
        position: "absolute",
        left: cssPixel(x),
        top: cssPixel(y),
        minWidth: "18px",
        height: "16px",
        borderRadius: "999px",
        border: "1px solid #fff",
        background: "var(--map-photos)",
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

function mapViewFromParam(value: string | null, mode: PlacesExplorerState["mode"]): MapViewId {
  if (mode === "review") return "unresolved"
  return value === "density" || value === "unresolved" ? value : "places"
}

function enrichmentsFromParam(value: string | null) {
  const allowed: EnrichmentId[] = ["people", "photos", "spending"]
  if (!value) return new Set<EnrichmentId>()
  return new Set(value.split(",").filter((item): item is EnrichmentId => allowed.includes(item as EnrichmentId)))
}

function unresolvedVisitTitle(visit: UnresolvedVisitMapItem) {
  if (!visit.aiEnrichment) return `Unresolved visit · ${Math.round(visit.confidence)}% import confidence`
  return `${visit.aiEnrichment.placeName} · ${Math.round(visit.aiEnrichment.confidence * 100)}% AI confidence`
}

function enrichmentColor(confidence: number) {
  if (confidence >= 0.75) return "var(--map-confidence-high)"
  if (confidence >= 0.45) return "var(--map-confidence-medium)"
  return "var(--map-confidence-low)"
}

function totalSpend(places: PlaceMapItem[]) {
  return places.reduce((sum, place) => sum + (place.stats.totalSpend ?? 0), 0)
}

function money(value: number) {
  return formatRoundedCurrency(value)
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
}

function labelize(value?: string) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()) : ""
}

function shortGroupLabel(label: string) {
  return label.split(/\s+/).map(word => word[0]).join("").slice(0, 3).toUpperCase()
}


function placeTypeColor(placeType?: string) {
  const palette: Record<string, string> = {
    cafe: "var(--cognac)",
    coffee: "var(--cognac)",
    restaurant: "var(--map-type-food)",
    bar: "var(--map-type-nightlife)",
    store: "var(--map-type-retail)",
    shop: "var(--map-type-retail)",
    grocery: "var(--map-type-nature)",
    home: "var(--map-type-home)",
    office: "var(--map-type-work)",
    gym: "var(--map-confidence-low)",
    hotel: "var(--map-type-lodging)",
    airport: "var(--map-type-travel)",
    park: "var(--map-type-nature)",
  }
  if (!placeType) return "var(--map-type-default)"
  return palette[placeType] ?? hashColor(placeType)
}

function hashColor(value: string) {
  const colors = ["var(--cognac)", "var(--map-type-retail)", "var(--map-type-nightlife)", "var(--map-type-work)", "var(--map-type-travel)", "var(--map-confidence-low)", "var(--map-type-nature)"]
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
