"use client"

import { useEffect, useRef, useState } from "react"
import { load, type Annotation, type Map as MapKitMap, type MapKit } from "@apple/mapkit-loader"
import { initializeMapKit, sanitizeMapKitToken, type MapKitInitializable } from "./apple-map-auth"
import { boundsForRegion, cameraForRegion, regionForCamera } from "./apple-map-camera"
import { markerSize, type Camera, type MapBounds } from "./map-computation"

type MappablePlace = {
  id: string
  name: string
  latitude?: number
  longitude?: number
  placeType?: string
  stats: {
    visitCount: number
    totalSpend?: number
  }
  weight: number
}

type MappableVisit = {
  id: string
  latitude: number
  longitude: number
  aiEnrichment?: { placeName: string; confidence: number }
}

type AnnotationData = {
  kind: "place" | "visit" | "cluster"
  id?: string
  memberIds?: string[]
}

export type MapFocus = { id: string; latitude: number; longitude: number }

type ApplePlacesMapProps = {
  token?: string
  places: MappablePlace[]
  visits: MappableVisit[]
  unresolvedActive: boolean
  selectedPlaceId: string | null
  selectedVisitId: string | null
  initialCamera: Camera | null
  fitRequest: number
  focus: MapFocus | null
  peopleCounts: Map<string, number>
  spendingCounts: Map<string, number>
  photoCounts: Map<string, number>
  peopleActive: boolean
  spendingActive: boolean
  photosActive: boolean
  densityActive: boolean
  onCameraChange: (camera: Camera, bounds: MapBounds) => void
  onSelectPlace: (id: string) => void
  onSelectVisit: (id: string) => void
  onClearSelection: () => void
}

export function ApplePlacesMap({
  token,
  places,
  visits,
  unresolvedActive,
  selectedPlaceId,
  selectedVisitId,
  initialCamera,
  fitRequest,
  focus,
  peopleCounts,
  spendingCounts,
  photoCounts,
  peopleActive,
  spendingActive,
  photosActive,
  densityActive,
  onCameraChange,
  onSelectPlace,
  onSelectVisit,
  onClearSelection,
}: ApplePlacesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapKitMap | null>(null)
  const mapKitRef = useRef<MapKit | null>(null)
  const annotationsRef = useRef<Annotation[]>([])
  const initialFitDoneRef = useRef(Boolean(initialCamera))
  const sizeRef = useRef({ width: 820, height: 620 })
  const callbacksRef = useRef({ onCameraChange, onSelectPlace, onSelectVisit, onClearSelection })
  const mapKitToken = sanitizeMapKitToken(token)
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(mapKitToken ? "loading" : "idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    callbacksRef.current = { onCameraChange, onSelectPlace, onSelectVisit, onClearSelection }
  }, [onCameraChange, onClearSelection, onSelectPlace, onSelectVisit])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !mapKitToken) return
    let cancelled = false
    let map: MapKitMap | null = null
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect?.width && rect.height) sizeRef.current = { width: rect.width, height: rect.height }
    })
    observer.observe(container)

    void load({ language: "en-US" })
      .then(async mapkit => {
        if (cancelled) return
        await initializeMapKit(mapkit as MapKitInitializable, mapKitToken)
        if (cancelled) return
        mapKitRef.current = mapkit
        const region = initialCamera
          ? regionForCamera(initialCamera, sizeRef.current.width, sizeRef.current.height)
          : undefined
        map = new mapkit.Map(container, {
          mapType: mapkit.MapType.MutedStandard,
          region,
          isRotationEnabled: false,
          showsMapTypeControl: true,
          showsZoomControl: true,
          showsScale: mapkit.FeatureVisibility.Adaptive,
          showsCompass: mapkit.FeatureVisibility.Hidden,
          showsPointsOfInterest: true,
          selectableMapFeatures: [],
          tintColor: resolvedColor(container, "--cognac", "#8f6b4a"),
          padding: { top: 88, right: 28, bottom: 40, left: 28 },
          annotationForCluster: cluster => {
            const memberIds = cluster.memberAnnotations
              .map(annotation => annotationData(annotation).id)
              .filter((id): id is string => Boolean(id))
            return new mapkit.MarkerAnnotation(cluster.coordinate, {
              title: `${memberIds.length} nearby places`,
              accessibilityLabel: `${memberIds.length} nearby places`,
              color: resolvedColor(container, "--petrol", "#1a2a35"),
              glyphColor: "#ffffff",
              glyphText: String(memberIds.length),
              data: { kind: "cluster", memberIds } satisfies AnnotationData,
              calloutEnabled: false,
            })
          },
        })
        mapRef.current = map

        const onRegionChange = () => {
          if (!map) return
          const regionValue = map.region
          callbacksRef.current.onCameraChange(
            cameraForRegion(regionValue, sizeRef.current.width),
            boundsForRegion(regionValue),
          )
        }
        const onSelect = (event: Event) => {
          if (!map) return
          const annotation = (event as Event & { annotation?: Annotation }).annotation
          if (!annotation) return
          const data = annotationData(annotation)
          if (data.kind === "cluster" && data.memberIds?.length) {
            const members = annotationsRef.current.filter(item => {
              const id = annotationData(item).id
              return id ? data.memberIds!.includes(id) : false
            })
            if (members.length) map.showItems(members, { animate: true, padding: { top: 88, right: 48, bottom: 56, left: 48 } })
            map.selectedAnnotation = null
          } else if (data.kind === "place" && data.id) {
            callbacksRef.current.onSelectPlace(data.id)
          } else if (data.kind === "visit" && data.id) {
            callbacksRef.current.onSelectVisit(data.id)
          }
        }
        const onBackgroundTap = () => callbacksRef.current.onClearSelection()
        map.addEventListener("region-change-end", onRegionChange)
        map.addEventListener("select", onSelect)
        map.addEventListener("single-tap", onBackgroundTap)
        setStatus("ready")
      })
      .catch(error => {
        if (cancelled) return
        console.error("[places map] MapKit JS failed to initialize", error)
        setErrorMessage(error instanceof Error ? error.message : "Apple Maps could not load. Check the Maps token and its allowed domains, then reload.")
        setStatus("error")
      })

    return () => {
      cancelled = true
      observer.disconnect()
      mapRef.current = null
      mapKitRef.current = null
      annotationsRef.current = []
      map?.destroy()
    }
  }, [initialCamera, mapKitToken])

  useEffect(() => {
    const map = mapRef.current
    const mapkit = mapKitRef.current
    const container = containerRef.current
    if (status !== "ready" || !map || !mapkit || !container) return

    const nextAnnotations = unresolvedActive
      ? visits.map(visit => createVisitAnnotation(mapkit, visit, visit.id === selectedVisitId))
      : places.flatMap(place => createPlaceAnnotation({
        mapkit,
        container,
        place,
        selected: place.id === selectedPlaceId,
        densityActive,
        peopleCount: peopleActive ? peopleCounts.get(place.id) : undefined,
        spendingCount: spendingActive ? spendingCounts.get(place.id) : undefined,
        photoCount: photosActive ? photoCounts.get(place.id) : undefined,
      }))

    if (annotationsRef.current.length) map.removeAnnotations(annotationsRef.current)
    annotationsRef.current = map.addAnnotations(nextAnnotations)
    map.selectedAnnotation = annotationsRef.current.find(annotation => annotationData(annotation).id === (unresolvedActive ? selectedVisitId : selectedPlaceId)) ?? null
    if (!initialFitDoneRef.current && annotationsRef.current.length) {
      map.showItems(annotationsRef.current, { animate: false, padding: { top: 96, right: 52, bottom: 60, left: 52 } })
      initialFitDoneRef.current = true
    }
  }, [densityActive, peopleActive, peopleCounts, photoCounts, photosActive, places, selectedPlaceId, selectedVisitId, spendingActive, spendingCounts, status, unresolvedActive, visits])

  const lastFitRequestRef = useRef(fitRequest)
  useEffect(() => {
    if (fitRequest === lastFitRequestRef.current) return
    lastFitRequestRef.current = fitRequest
    const map = mapRef.current
    if (map && annotationsRef.current.length) {
      map.showItems(annotationsRef.current, { animate: true, padding: { top: 96, right: 52, bottom: 60, left: 52 } })
    }
  }, [fitRequest])

  const lastFocusRef = useRef<string | null>(null)
  useEffect(() => {
    if (!focus || focus.id === lastFocusRef.current) return
    lastFocusRef.current = focus.id
    const map = mapRef.current
    if (!map) return
    const currentCamera = cameraForRegion(map.region, sizeRef.current.width)
    map.setRegionAnimated(regionForCamera({
      lat: focus.latitude,
      lng: focus.longitude,
      zoom: Math.max(currentCamera.zoom, 15),
    }, sizeRef.current.width, sizeRef.current.height), true)
  }, [focus])

  return (
    <div className="apple-map-shell">
      <div ref={containerRef} className="apple-map-container" aria-label="Apple map of places" />
      {status === "loading" ? <div className="apple-map-status" role="status">Loading Apple Maps…</div> : null}
      {!mapKitToken ? (
        <div className="apple-map-status apple-map-status-error" role="status">
          <strong>Apple Maps needs a Maps token</strong>
          <span>Add a domain-restricted <code>APPLE_MAPS_TOKEN</code> to the Places environment.</span>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="apple-map-status apple-map-status-error" role="alert">
          <strong>Apple Maps is unavailable</strong>
          <span>{errorMessage}</span>
        </div>
      ) : null}
    </div>
  )
}

function createPlaceAnnotation({
  mapkit,
  container,
  place,
  selected,
  densityActive,
  peopleCount,
  spendingCount,
  photoCount,
}: {
  mapkit: MapKit
  container: HTMLElement
  place: MappablePlace
  selected: boolean
  densityActive: boolean
  peopleCount?: number
  spendingCount?: number
  photoCount?: number
}) {
  if (typeof place.latitude !== "number" || typeof place.longitude !== "number") return []
  const size = densityActive
    ? markerSize(place.stats.totalSpend ?? 0, Math.max(place.stats.visitCount, place.weight))
    : selected ? 30 : 22
  const element = document.createElement("div")
  element.className = `apple-place-marker${selected ? " is-selected" : ""}`
  element.style.setProperty("--marker-size", `${size}px`)
  element.style.setProperty("--marker-color", resolvedPlaceColor(container, place.placeType))
  element.setAttribute("aria-label", place.name)
  if (densityActive && place.stats.visitCount > 1) {
    const count = document.createElement("span")
    count.className = "apple-place-marker-count"
    count.textContent = String(place.stats.visitCount)
    element.append(count)
  }
  appendBadge(element, peopleCount, "people", "--map-people")
  appendBadge(element, spendingCount ? "$" : undefined, "spending", "--map-spending")
  appendBadge(element, photoCount, "photos", "--map-photos")

  const annotation = new mapkit.Annotation(
    new mapkit.Coordinate(place.latitude, place.longitude),
    () => element,
    {
      title: place.name,
      subtitle: `${place.stats.visitCount} ${place.stats.visitCount === 1 ? "visit" : "visits"}`,
      accessibilityLabel: `${place.name}, ${place.stats.visitCount} ${place.stats.visitCount === 1 ? "visit" : "visits"}`,
      data: { kind: "place", id: place.id } satisfies AnnotationData,
      clusteringIdentifier: "life-os-place",
      collisionMode: mapkit.AnnotationCollisionMode.Circle,
      displayPriority: selected ? mapkit.AnnotationDisplayPriority.Required : mapkit.AnnotationDisplayPriority.High,
      selected,
      calloutEnabled: false,
      size: { width: size, height: size },
    },
  )
  return [annotation]
}

function createVisitAnnotation(mapkit: MapKit, visit: MappableVisit, selected: boolean) {
  const element = document.createElement("div")
  element.className = `apple-place-marker apple-visit-marker${selected ? " is-selected" : ""}`
  element.style.setProperty("--marker-size", "26px")
  element.style.setProperty("--marker-color", "rgba(55, 120, 194, 0.76)")
  element.textContent = "?"
  if (visit.aiEnrichment) {
    const confidence = visit.aiEnrichment.confidence
    const color = confidence >= 0.75
      ? "--map-confidence-high"
      : confidence >= 0.45 ? "--map-confidence-medium" : "--map-confidence-low"
    appendBadge(element, "", "confidence", color)
  }
  return new mapkit.Annotation(
    new mapkit.Coordinate(visit.latitude, visit.longitude),
    () => element,
    {
      title: visit.aiEnrichment?.placeName ?? "Unresolved visit",
      accessibilityLabel: visit.aiEnrichment?.placeName ?? "Unresolved visit",
      data: { kind: "visit", id: visit.id } satisfies AnnotationData,
      clusteringIdentifier: "life-os-unresolved-visit",
      collisionMode: mapkit.AnnotationCollisionMode.Circle,
      displayPriority: selected ? mapkit.AnnotationDisplayPriority.Required : mapkit.AnnotationDisplayPriority.High,
      selected,
      calloutEnabled: false,
      size: { width: 26, height: 26 },
    },
  )
}

function appendBadge(element: HTMLElement, value: string | number | undefined, kind: string, colorToken: string) {
  if (value === undefined || value === 0) return
  const badge = document.createElement("span")
  badge.className = `apple-place-marker-badge badge-${kind}`
  badge.style.setProperty("--badge-color", `var(${colorToken})`)
  badge.textContent = String(value)
  element.append(badge)
}

function annotationData(annotation: Annotation): AnnotationData {
  const data = annotation.data as Partial<AnnotationData> | undefined
  return data?.kind ? data as AnnotationData : { kind: "cluster", memberIds: [] }
}

function resolvedPlaceColor(container: HTMLElement, placeType?: string) {
  const palette: Record<string, string> = {
    cafe: "--cognac",
    coffee: "--cognac",
    restaurant: "--map-type-food",
    bar: "--map-type-nightlife",
    store: "--map-type-retail",
    shop: "--map-type-retail",
    grocery: "--map-type-nature",
    home: "--map-type-home",
    office: "--map-type-work",
    gym: "--map-confidence-low",
    hotel: "--map-type-lodging",
    airport: "--map-type-travel",
    park: "--map-type-nature",
  }
  return resolvedColor(container, palette[placeType ?? ""] ?? "--map-type-default", "#8f6b4a")
}

function resolvedColor(element: HTMLElement, property: string, fallback: string) {
  return getComputedStyle(element).getPropertyValue(property).trim() || fallback
}
