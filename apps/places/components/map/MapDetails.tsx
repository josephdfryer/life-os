import Link from "next/link"
import { formatDate, formatRoundedCurrency } from "@/lib/format"

type PlacePreviewItem = {
  id: string
  name: string
  latitude?: number
  longitude?: number
  address?: string
  googlePlaceId?: string
  placeType?: string
  stats: { visitCount: number; photoCount: number; totalSpend?: number; lastVisitAt?: string }
}

type UnresolvedVisitPreviewItem = {
  importJobId: string
  latitude: number
  longitude: number
  placeAddress?: string
  startedAt: string
  confidence: number
  aiEnrichment?: { placeName: string; category: string; confidence: number; reasoning: string }
}

export function PlacePreview({ place, returnQuery }: { place: PlacePreviewItem; returnQuery?: string }) {
  const coordinateLabel = hasCoordinates(place) ? coordinatesText(place.latitude, place.longitude) : ""
  const googleMapsHref = hasCoordinates(place)
    ? `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`
    : undefined
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
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
          <MiniStat label="Spend" value={place.stats.totalSpend ? formatRoundedCurrency(place.stats.totalSpend) : "$0"} />
        </div>
        <div style={{ fontSize: "11px", color: "var(--ink-4)", marginTop: "12px" }}>
          Last visit: {place.stats.lastVisitAt ? formatDate(place.stats.lastVisitAt) : "Never"}
        </div>
        <Link
          href={`/places/${place.id}${returnQuery ? `?from=${encodeURIComponent(returnQuery)}` : ""}`}
          style={{ marginTop: "14px", display: "inline-flex", padding: "9px 16px", background: "var(--cognac)", color: "#fff", borderRadius: "var(--radius-pill)", textDecoration: "none", fontSize: "12px" }}
        >
          Open memory
        </Link>
      </div>
    </div>
  )
}

export function UnresolvedVisitPreview({ visit }: { visit: UnresolvedVisitPreviewItem }) {
  const coordinateLabel = coordinatesText(visit.latitude, visit.longitude)
  const googleMapsHref = `https://www.google.com/maps/search/?api=1&query=${visit.latitude},${visit.longitude}`
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ padding: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: 0 }}>Unresolved visit</h2>
        <div style={{ fontSize: "11px", color: "var(--ink-3)", marginTop: "4px" }}>{formatDate(visit.startedAt)} · {Math.round(visit.confidence)}% import confidence</div>
        <div style={{ display: "grid", gap: "6px", marginTop: "12px", fontSize: "11px", color: "var(--ink-3)" }}>
          <DetailRow label="Address" value={visit.placeAddress || "No text address in export"} />
          <DetailRow label="Coordinates" value={coordinateLabel} href={googleMapsHref} />
        </div>
        {visit.aiEnrichment ? (
          <div style={{ marginTop: "14px", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px", background: "var(--bg)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
              <div style={{ fontSize: "12px", fontWeight: 700 }}>{visit.aiEnrichment.placeName}</div>
              <div style={{ fontSize: "10px", color: enrichmentColor(visit.aiEnrichment.confidence), fontWeight: 700 }}>{Math.round(visit.aiEnrichment.confidence * 100)}%</div>
            </div>
            <div style={{ fontSize: "10px", color: "var(--ink-3)", marginTop: "3px" }}>{labelize(visit.aiEnrichment.category)}</div>
            <div style={{ fontSize: "11px", color: "var(--ink-2)", marginTop: "8px" }}>{visit.aiEnrichment.reasoning}</div>
          </div>
        ) : <div style={{ marginTop: "14px", fontSize: "11px", color: "var(--ink-4)" }}>No AI enrichment result yet.</div>}
        <Link
          href={`/places/import/${visit.importJobId}/review`}
          style={{ marginTop: "14px", display: "inline-flex", padding: "9px 16px", background: "var(--cognac)", color: "#fff", borderRadius: "var(--radius-pill)", textDecoration: "none", fontSize: "12px" }}
        >
          Resolve this visit
        </Link>
      </div>
    </div>
  )
}

function DetailRow({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = href ? <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>{value}</a> : value
  return <div style={{ display: "grid", gridTemplateColumns: "76px minmax(0, 1fr)", gap: "8px" }}><span style={{ color: "var(--ink-4)" }}>{label}</span><span style={{ overflowWrap: "anywhere" }}>{content}</span></div>
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "8px", background: "var(--bg)" }}><div style={{ fontSize: "15px", color: "var(--ink)", fontWeight: 600 }}>{value}</div><div style={{ fontSize: "9px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div></div>
}

function hasCoordinates(place: PlacePreviewItem): place is PlacePreviewItem & { latitude: number; longitude: number } {
  return typeof place.latitude === "number" && typeof place.longitude === "number"
}

function coordinatesText(latitude: number, longitude: number) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
}

function labelize(value?: string) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()) : ""
}

function enrichmentColor(confidence: number) {
  if (confidence >= 0.75) return "var(--map-confidence-high)"
  if (confidence >= 0.45) return "var(--map-confidence-medium)"
  return "var(--map-confidence-low)"
}
