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
import { ApplePlacesMap, type MapFocus } from "@/components/map/ApplePlacesMap"
import { groupUnresolvedObservations } from "@/components/map/unresolved-groups"
import { cameraFromParams } from "@/components/map/apple-map-camera"
import {
  explorerStateFromParams,
  explorerFacetCounts,
  filterAndSortPlaces,
  placeTypes,
  sparseFilterCounts,
  updateExplorerParams,
  type PlacesExplorerState,
} from "@/components/map/explorer-state"
import type { Camera, MapBounds } from "@/components/map/map-computation"
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

export default function PlacesClient({ places, layers, mapKitToken, errorMessage }: { places: PlaceMapItem[]; layers: MapLayerData; mapKitToken?: string; errorMessage?: string }) {
  const searchParams = useSearchParams()
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)
  const [initialMapCamera] = useState<Camera | null>(() => cameraFromParams(new URLSearchParams(searchParams.toString())))
  const [mapCamera, setMapCamera] = useState<Camera | null>(() => cameraFromParams(new URLSearchParams(searchParams.toString())))
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null)
  const [fitRequest, setFitRequest] = useState(0)
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null)
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
  const peopleCounts = useMemo(() => new Map(layers.interactions.map(item => [item.placeId, item.interactionCount])), [layers.interactions])
  const spendingCounts = useMemo(() => new Map(layers.finance.map(item => [item.placeId, item.transactionCount])), [layers.finance])
  const photoCounts = useMemo(() => new Map(layers.photos.map(item => [item.placeId, item.photoCount])), [layers.photos])

  useEffect(() => {
    if (!mapCamera) return
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search)
      params.set("lat", mapCamera.lat.toFixed(5))
      params.set("lng", mapCamera.lng.toFixed(5))
      params.set("z", mapCamera.zoom.toFixed(2))
      const query = params.toString()
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [mapCamera])

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
          <section aria-label="Places map" className="places-map-canvas">
            <ApplePlacesMap
              token={mapKitToken}
              places={filtered}
              visits={layers.unresolvedVisits}
              unresolvedActive={unresolvedActive}
              selectedPlaceId={selected?.id ?? null}
              selectedVisitId={selectedVisitId}
              initialCamera={initialMapCamera}
              fitRequest={fitRequest}
              focus={mapFocus}
              peopleCounts={peopleCounts}
              spendingCounts={spendingCounts}
              photoCounts={photoCounts}
              peopleActive={peopleActive}
              spendingActive={spendingActive}
              photosActive={photosActive}
              densityActive={activeMapView === "density"}
              onCameraChange={(camera, bounds) => {
                setMapCamera(camera)
                setMapBounds(bounds)
              }}
              onSelectPlace={id => {
                updateExplorer({ selectedId: id }, "push")
                setSelectedVisitId(null)
              }}
              onSelectVisit={id => {
                setSelectedVisitId(id)
                updateExplorer({ selectedId: null })
              }}
              onClearSelection={() => {
                setSelectedVisitId(null)
                if (explorerState.selectedId) updateExplorer({ selectedId: null })
              }}
            />
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
            <button
              type="button"
              className="places-fit-map"
              aria-label={unresolvedActive ? "Fit map to unresolved visits" : "Fit map to places"}
              onClick={() => setFitRequest(value => value + 1)}
            >
              Fit
            </button>
            {!unresolvedActive && mapBounds ? (
              <button
                type="button"
                className="places-search-area"
                onClick={() => updateExplorer({
                  bounds: mapBounds,
                  selectedId: null,
                }, "push")}
              >
                Search this area
              </button>
            ) : null}
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
            ) : null}
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
                    setMapFocus({ id: `visit:${visit.id}`, latitude: visit.latitude, longitude: visit.longitude })
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
                      setMapFocus({ id: `place:${place.id}`, latitude: place.latitude, longitude: place.longitude })
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


function mapViewFromParam(value: string | null, mode: PlacesExplorerState["mode"]): MapViewId {
  if (mode === "review") return "unresolved"
  return value === "density" || value === "unresolved" ? value : "places"
}

function enrichmentsFromParam(value: string | null) {
  const allowed: EnrichmentId[] = ["people", "photos", "spending"]
  if (!value) return new Set<EnrichmentId>()
  return new Set(value.split(",").filter((item): item is EnrichmentId => allowed.includes(item as EnrichmentId)))
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
