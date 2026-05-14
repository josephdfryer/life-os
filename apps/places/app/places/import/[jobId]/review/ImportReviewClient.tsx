"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

type StagedVisit = {
  id: string
  placeName: string | null
  placeAddress: string | null
  googlePlaceId: string | null
  startedAt: string
  endedAt: string | null
  confidence: number
  status: string
}

type StagedPayload = { items: StagedVisit[]; total: number; hasMore: boolean }

export default function ImportReviewClient({ jobId, initial }: { jobId: string; initial: StagedPayload }) {
  const [payload, setPayload] = useState(initial)
  const [index, setIndex] = useState(0)
  const current = payload.items[index] ?? null

  async function refresh() {
    const response = await fetch(`/api/import/${jobId}/staged?pageSize=50&status=pending`)
    if (response.ok) setPayload(await response.json())
  }

  async function act(action: "accept" | "reject" | "skip") {
    if (!current) return
    if (action === "skip") {
      setIndex(value => Math.min(payload.items.length - 1, value + 1))
      return
    }
    const response = await fetch(`/api/import/${jobId}/staged/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    if (response.ok) await refresh()
  }

  async function acceptConfident() {
    await fetch(`/api/import/${jobId}/staged/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept", minConfidence: 60 }),
    })
    await refresh()
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "a") void act("accept")
      if (event.key === "r") void act("reject")
      if (event.key === "s") void act("skip")
      if (event.key === "j") setIndex(value => Math.min(payload.items.length - 1, value + 1))
      if (event.key === "k") setIndex(value => Math.max(0, value - 1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [current?.id, payload.items.length])

  const duration = useMemo(() => current ? durationLabel(current.startedAt, current.endedAt) : "", [current])

  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "34px 24px 52px" }}>
      <Link href={`/places/import/${jobId}`} style={{ color: "var(--ink-3)", textDecoration: "none", fontSize: "12px" }}>← Import progress</Link>
      <header style={{ display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "38px", marginBottom: "4px" }}>Review staged visits</h1>
          <p style={{ color: "var(--ink-3)" }}>{payload.total.toLocaleString()} ambiguous visits waiting for a human eye.</p>
        </div>
        <button onClick={acceptConfident} style={secondaryButton}>Accept all ≥ 60%</button>
      </header>

      {current ? (
        <section style={{ marginTop: "20px", border: "1px solid var(--border)", borderRadius: "20px", background: "var(--surface)", overflow: "hidden" }}>
          <div style={{ height: "220px", background: "radial-gradient(circle at 28% 32%, rgba(196,87,42,0.28), transparent 28%), linear-gradient(135deg, #eee9df, #d8d0c1)", display: "grid", placeItems: "center", color: "var(--ink-3)" }}>
            Map thumbnail placeholder
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
            <div style={{ display: "flex", gap: "10px", marginTop: "22px", flexWrap: "wrap" }}>
              <button onClick={() => void act("accept")} style={primaryButton}>Accept <span style={{ opacity: 0.7 }}>(a)</span></button>
              <button onClick={() => void act("reject")} style={secondaryButton}>Reject <span style={{ opacity: 0.7 }}>(r)</span></button>
              <button onClick={() => void act("skip")} style={secondaryButton}>Skip <span style={{ opacity: 0.7 }}>(s)</span></button>
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
