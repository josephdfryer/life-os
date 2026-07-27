"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

type StagedVisit = {
  id: string
  placeName: string | null
  placeAddress: string | null
  googlePlaceId: string | null
  latitude: number | null
  longitude: number | null
  startedAt: string
  endedAt: string | null
  confidence: number
  status: string
  aiEnrichment: unknown
}

type ReviewProgress = { pending: number; accepted: number; rejected: number; total: number }
type StagedPayload = { items: StagedVisit[]; total: number; hasMore: boolean; progress: ReviewProgress }

type PlaceCandidate = {
  id: string
  name: string
  address: string | null
  placeType: string | null
  latitude: number | null
  longitude: number | null
  visitCount: number
  lastVisitAt: string | null
}

export default function ImportReviewClient({ jobId, initial, places, status }: { jobId: string; initial: StagedPayload; places: PlaceCandidate[]; status: "pending" | "rejected" }) {
  const [payload, setPayload] = useState(initial)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placeSearch, setPlaceSearch] = useState("")
  const [createName, setCreateName] = useState("")
  const [createAddress, setCreateAddress] = useState("")
  const [createType, setCreateType] = useState("")
  const current = payload.items[index] ?? null

  async function refresh() {
    const response = await fetch(`/api/import/${jobId}/staged?pageSize=50&status=${status}`)
    if (response.ok) setPayload(await response.json())
  }

  async function act(action: "accept" | "reject" | "skip" | "restore") {
    if (!current) return
    if (action === "skip") {
      setIndex(value => Math.min(payload.items.length - 1, value + 1))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/import/${jobId}/staged/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!response.ok) throw new Error("review action failed")
      await refresh()
      setIndex(value => Math.min(value, Math.max(0, payload.items.length - 2)))
    } catch {
      setError("That visit was not updated. Nothing was lost; try again.")
    } finally {
      setBusy(false)
    }
  }

  async function resolveVisit(resolution: { mode: "merge"; placeId: string } | { mode: "create"; name: string; address?: string; placeType?: string }) {
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/import/${jobId}/staged/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", resolution }),
      })
      if (!response.ok) throw new Error("resolution failed")
      await refresh()
      setIndex(value => Math.min(value, Math.max(0, payload.items.length - 2)))
      setPlaceSearch("")
      setCreateName("")
      setCreateAddress("")
      setCreateType("")
    } catch {
      setError("The visit was not resolved. No Place or Event was changed; try again.")
    } finally {
      setBusy(false)
    }
  }

  async function acceptConfident() {
    setBusy(true)
    setError(null)
    try {
      const preview = await fetch(`/api/import/${jobId}/staged/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", minConfidence: 60, dryRun: true }),
      })
      if (!preview.ok) throw new Error("bulk preview failed")
      const { matched } = await preview.json() as { matched: number }
      if (!matched) {
        setError("No pending visits meet the 60% confidence threshold.")
        return
      }
      if (!confirm(`Accept exactly ${matched} pending ${matched === 1 ? "visit" : "visits"} at 60% confidence or higher? This creates or links Place and Event records.`)) return
      const response = await fetch(`/api/import/${jobId}/staged/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", minConfidence: 60 }),
      })
      if (!response.ok) throw new Error("bulk accept failed")
      await refresh()
      setIndex(0)
    } catch {
      setError("The bulk action did not complete. Review the queue before trying again.")
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (busy) return
      if (event.key === "a" && status === "pending") void act("accept")
      if (event.key === "r") void act(status === "pending" ? "reject" : "restore")
      if (event.key === "s") void act("skip")
      if (event.key === "j") setIndex(value => Math.min(payload.items.length - 1, value + 1))
      if (event.key === "k") setIndex(value => Math.max(0, value - 1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [busy, current?.id, payload.items.length, status])

  const duration = useMemo(() => current ? durationLabel(current.startedAt, current.endedAt) : "", [current])
  const enrichment = useMemo(() => parseEnrichment(current?.aiEnrichment), [current?.aiEnrichment])
  const mapsHref = current?.latitude !== null && current?.latitude !== undefined && current?.longitude !== null && current?.longitude !== undefined
    ? `https://www.openstreetmap.org/?mlat=${current.latitude}&mlon=${current.longitude}#map=17/${current.latitude}/${current.longitude}`
    : null
  const candidatePlaces = useMemo(
    () => rankCandidatePlaces(places, current, placeSearch),
    [current, placeSearch, places],
  )
  const resolvedCount = payload.progress.accepted + payload.progress.rejected
  const progressPercent = payload.progress.total
    ? Math.round((resolvedCount / payload.progress.total) * 100)
    : 100

  return (
    <main className="places-review-page">
      <Link href={`/places/import/${jobId}`} style={{ color: "var(--ink-3)", textDecoration: "none", fontSize: "12px" }}>← Import progress</Link>
      <header className="places-review-header">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "38px", marginBottom: "4px" }}>Review staged visits</h1>
          <p style={{ color: "var(--ink-3)" }}>
            {payload.total.toLocaleString()} {status === "pending" ? "ambiguous visits waiting for a human eye." : "dismissed visits available to restore."}
          </p>
          <div className="places-review-progress" aria-label={`${progressPercent}% of staged visits reviewed`}>
            <div>
              <span>{resolvedCount.toLocaleString()} of {payload.progress.total.toLocaleString()} reviewed</span>
              <strong>{progressPercent}%</strong>
            </div>
            <progress max={Math.max(1, payload.progress.total)} value={resolvedCount}>{progressPercent}%</progress>
            <small>{payload.progress.pending.toLocaleString()} pending · {payload.progress.accepted.toLocaleString()} accepted · {payload.progress.rejected.toLocaleString()} dismissed</small>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Link href={`/places/import/${jobId}/review${status === "pending" ? "?status=rejected" : ""}`} style={secondaryButton}>
            {status === "pending" ? "Review dismissed" : "Back to pending"}
          </Link>
          {status === "pending" ? <button onClick={acceptConfident} style={secondaryButton} disabled={busy}>Preview bulk accept ≥ 60%</button> : null}
        </div>
      </header>

      {error ? <div className="place-mutation-error" role="alert">{error}</div> : null}

      {current ? (
        <section className="places-review-card">
          <div className="places-review-map">
            {mapsHref ? <a href={mapsHref} target="_blank" rel="noreferrer">Inspect coordinates on OpenStreetMap ↗</a> : "No coordinates available"}
          </div>
          <div style={{ padding: "22px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
              <div>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: "30px", margin: 0 }}>{current.placeName ?? "Unnamed Google place"}</h2>
                <p style={{ color: "var(--ink-3)", marginTop: "6px" }}>{current.placeAddress ?? current.googlePlaceId ?? "Needs manual naming"}</p>
              </div>
              <div style={{ color: "var(--accent)", fontWeight: 700 }}>{Math.round(current.confidence)}%</div>
            </div>
            <div style={{ color: "var(--ink-3)", marginTop: "12px" }}>{new Date(current.startedAt).toLocaleString()} · {duration}</div>
            {enrichment ? (
              <div className="places-review-suggestion">
                <div><span>Suggested identity</span><strong>{enrichment.placeName}</strong></div>
                <b>{Math.round(enrichment.confidence * 100)}%</b>
                <p>{labelize(enrichment.category)}</p>
                {enrichment.reasoning ? <p>{enrichment.reasoning}</p> : null}
              </div>
            ) : null}
            {status === "pending" ? <div className="places-resolution-panel">
              <div className="places-resolution-heading">
                <div>
                  <strong>Resolve into your trusted map</strong>
                  <span>Merging uses the selected Place exactly. Creating uses the identity you enter below.</span>
                </div>
              </div>

              <label className="places-resolution-search">
                <span>Merge into an existing Place</span>
                <input value={placeSearch} onChange={event => setPlaceSearch(event.target.value)} placeholder="Search nearby or named Places" />
              </label>
              <div className="places-resolution-candidates">
                {candidatePlaces.slice(0, 5).map(candidate => (
                  <button
                    key={candidate.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void resolveVisit({ mode: "merge", placeId: candidate.id })}
                  >
                    <span><strong>{candidate.name}</strong><small>{candidate.address ?? labelize(candidate.placeType ?? "Place")}</small></span>
                    <span><b>{candidate.visitCount} visits</b>{candidate.distanceMeters !== null ? <small>{distanceLabel(candidate.distanceMeters)}</small> : null}</span>
                  </button>
                ))}
              </div>

              <details className="places-resolution-create">
                <summary>Create a new Place instead</summary>
                <div>
                  <label><span>Name</span><input value={createName} onChange={event => setCreateName(event.target.value)} placeholder={enrichment?.placeName ?? current.placeName ?? "Place name"} /></label>
                  <label><span>Address</span><input value={createAddress} onChange={event => setCreateAddress(event.target.value)} placeholder={current.placeAddress ?? "Optional address"} /></label>
                  <label><span>Type</span><input value={createType} onChange={event => setCreateType(event.target.value)} placeholder={enrichment?.category ? labelize(enrichment.category) : "Optional type"} /></label>
                  <button
                    type="button"
                    style={primaryButton}
                    disabled={busy || !(createName.trim() || enrichment?.placeName || current.placeName)}
                    onClick={() => void resolveVisit({
                      mode: "create",
                      name: createName.trim() || enrichment?.placeName || current.placeName || "",
                      address: createAddress.trim() || current.placeAddress || undefined,
                      placeType: createType.trim() || enrichment?.category || undefined,
                    })}
                  >
                    Create Place and accept visit
                  </button>
                </div>
              </details>
            </div> : null}
            <div style={{ display: "flex", gap: "10px", marginTop: "22px", flexWrap: "wrap" }}>
              {status === "pending" ? (
                <>
                  <button onClick={() => void act("accept")} style={primaryButton} disabled={busy}>Accept best suggestion <span style={{ opacity: 0.7 }}>(a)</span></button>
                  <button onClick={() => void act("reject")} style={secondaryButton} disabled={busy}>Dismiss as noise <span style={{ opacity: 0.7 }}>(r)</span></button>
                  <button onClick={() => void act("skip")} style={secondaryButton} disabled={busy}>Decide later <span style={{ opacity: 0.7 }}>(s)</span></button>
                </>
              ) : (
                <button onClick={() => void act("restore")} style={primaryButton} disabled={busy}>Restore to pending <span style={{ opacity: 0.7 }}>(r)</span></button>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section style={{ marginTop: "20px", border: "1px solid var(--border)", borderRadius: "20px", padding: "30px", background: "var(--surface)" }}>
          Review queue is clear. The map gets a little more Joseph-shaped every time this happens.
        </section>
      )}
      <p style={{ color: "var(--ink-3)", fontSize: "11px" }}>Shortcuts: a accept, r reject, s skip, j/k navigate.</p>
    </main>
  )
}

const primaryButton = { border: 0, borderRadius: "999px", padding: "11px 16px", background: "var(--accent)", color: "white", cursor: "pointer", fontFamily: "inherit" }
const secondaryButton = { border: "1px solid var(--border)", borderRadius: "999px", padding: "10px 15px", background: "transparent", color: "var(--ink)", cursor: "pointer", fontFamily: "inherit" }

function durationLabel(start: string, end: string | null) {
  if (!end) return "unknown duration"
  const minutes = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000))
  return `${minutes} min`
}

function parseEnrichment(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const confidence = Number(record.confidence)
  if (typeof record.placeName !== "string" || !Number.isFinite(confidence)) return null
  return {
    placeName: record.placeName,
    category: typeof record.category === "string" ? record.category : "unknown",
    confidence: Math.max(0, Math.min(1, confidence)),
    reasoning: typeof record.reasoning === "string" ? record.reasoning : "",
  }
}

function labelize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase())
}

function rankCandidatePlaces(places: PlaceCandidate[], visit: StagedVisit | null, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return places
    .map(place => ({
      ...place,
      distanceMeters: distanceBetween(place.latitude, place.longitude, visit?.latitude ?? null, visit?.longitude ?? null),
    }))
    .filter(place => {
      if (normalizedQuery) return `${place.name} ${place.address ?? ""}`.toLocaleLowerCase().includes(normalizedQuery)
      return place.distanceMeters !== null && place.distanceMeters <= 2_000
    })
    .toSorted((a, b) =>
      (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY) ||
      b.visitCount - a.visitCount ||
      a.name.localeCompare(b.name)
    )
}

function distanceBetween(latA: number | null, lngA: number | null, latB: number | null, lngB: number | null) {
  if (latA === null || lngA === null || latB === null || lngB === null) return null
  const radians = Math.PI / 180
  const dLat = (latB - latA) * radians
  const dLng = (lngB - lngA) * radians
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(latA * radians) * Math.cos(latB * radians) * Math.sin(dLng / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function distanceLabel(meters: number) {
  if (meters < 1_000) return `${Math.round(meters)} m away`
  return `${(meters / 1_000).toFixed(1)} km away`
}
