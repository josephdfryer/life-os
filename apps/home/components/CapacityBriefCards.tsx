"use client"

import { useState } from "react"

export type SerializedIntervention = {
  id: string
  briefId: string
  rank: number
  category: string
  recommendationText: string
  reasonCodes: string[]
  evidence: Record<string, unknown> | null
  proposedCommand: { command: string; input: Record<string, unknown> } | null
  riskTier: string
  status: string
  reviewItemId: string | null
  resultType: string | null
  resultId: string | null
  createdAt: string
  outcomes: { id: string; source: string; outcome: string; note: string | null; createdAt: string }[]
}

export type SerializedBrief = {
  id: string
  workspaceId: string
  day: string
  timezone: string
  rulesVersion: string
  capacityBand: string
  inputSnapshot: string
  missingSignals: string[]
  generatedAt: string
  status: string
  createdAt: string
  updatedAt: string
  interventions: SerializedIntervention[]
}

const BAND_LABEL: Record<string, string> = { full: "Full capacity", adjust: "Constrained", recover: "Recovery day" }
const BAND_EXPLAIN: Record<string, string> = {
  full: "Nothing today suggests holding back.",
  adjust: "Today has some real constraints — a lighter touch makes sense.",
  recover: "Today looks like a day to protect, not add to.",
}
const MISSING_LABEL: Record<string, string> = {
  levelUpReadiness: "Level Up readiness",
  energyCheckIn: "energy check-in",
  stressCheckIn: "stress check-in",
}

function toDatetimeLocal(iso: string) {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function CapacityBriefCards({ brief, isToday, timezone }: { brief: SerializedBrief; isToday: boolean; timezone: string }) {
  const [interventions, setInterventions] = useState(brief.interventions)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pending = interventions.filter(iv => iv.status === "pending")

  async function resolve(id: string, action: "accept" | "edit_and_accept" | "dismiss", editedInput?: Record<string, unknown>) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/adaptive-day/interventions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, editedInput }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        setError(body?.error ?? "Couldn't do that — try again.")
        return
      }
      const resolved = await res.json() as { status: string }
      setInterventions(prev => prev.map(iv => (iv.id === id ? { ...iv, status: resolved.status } : iv)))
      setEditingId(null)
    } finally {
      setBusyId(null)
    }
  }

  async function refresh() {
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch("/api/adaptive-day/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone }),
      })
      if (!res.ok) {
        setError("Couldn't refresh — try again.")
        return
      }
      const next = await res.json() as SerializedBrief
      setInterventions(next.interventions)
    } finally {
      setRefreshing(false)
    }
  }

  function startEdit(iv: SerializedIntervention) {
    const start = iv.proposedCommand?.input.scheduledStart
    setEditValue(typeof start === "string" ? toDatetimeLocal(start) : "")
    setEditingId(iv.id)
  }

  function saveEdit(iv: SerializedIntervention) {
    if (!editValue) return
    const newStart = new Date(editValue)
    const originalStart = iv.proposedCommand?.input.scheduledStart
    const originalEnd = iv.proposedCommand?.input.scheduledEnd
    let scheduledEnd: string | undefined
    if (typeof originalStart === "string" && typeof originalEnd === "string") {
      const durationMs = new Date(originalEnd).getTime() - new Date(originalStart).getTime()
      scheduledEnd = new Date(newStart.getTime() + durationMs).toISOString()
    }
    resolve(iv.id, "edit_and_accept", { scheduledStart: newStart.toISOString(), ...(scheduledEnd ? { scheduledEnd } : {}) })
  }

  return (
    <section className="reconcile-widget" aria-labelledby="capacity-brief-heading">
      <div className="reconcile-heading">
        <div>
          <div className="quick-capture-eyebrow">{BAND_LABEL[brief.capacityBand] ?? brief.capacityBand}</div>
          <h2 id="capacity-brief-heading">{BAND_EXPLAIN[brief.capacityBand] ?? "Today's capacity"}</h2>
        </div>
        {isToday && (
          <button
            onClick={refresh}
            disabled={refreshing}
            style={{ background: "transparent", border: "1px solid rgba(196, 165, 116, 0.3)", borderRadius: "6px", color: "var(--ink-3)", fontSize: "11px", padding: "5px 10px", cursor: refreshing ? "wait" : "pointer" }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      {brief.missingSignals.length > 0 && (
        <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "16px" }}>
          Missing: {brief.missingSignals.map(s => MISSING_LABEL[s] ?? s).join(", ")} — not held against today's read.
        </div>
      )}

      {pending.length === 0 ? (
        <div className="capture-analysis-status">Nothing to suggest right now.</div>
      ) : (
        <div className="reconcile-list">
          {pending.map(iv => (
            <div key={iv.id} className="reconcile-card">
              <div style={{ fontSize: "13px", color: "var(--ink)" }}>{iv.recommendationText}</div>

              <button
                onClick={() => setExpandedId(id => (id === iv.id ? null : iv.id))}
                style={{ marginTop: "8px", padding: 0, border: 0, background: "transparent", color: "var(--ink-4)", fontSize: "11px", cursor: "pointer", textDecoration: "underline" }}
              >
                {expandedId === iv.id ? "Hide why" : "Why this?"}
              </button>
              {expandedId === iv.id && (
                <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--ink-4)", lineHeight: 1.6 }}>
                  <div>{iv.reasonCodes.join(" · ")}</div>
                  {iv.evidence && (
                    <pre style={{ marginTop: "6px", padding: "8px", background: "rgba(0,0,0,0.15)", borderRadius: "6px", overflowX: "auto", fontSize: "10px" }}>
                      {JSON.stringify(iv.evidence, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {isToday && editingId !== iv.id && (
                <div className="reconcile-actions">
                  <button onClick={() => resolve(iv.id, "accept")} disabled={busyId === iv.id}>
                    {iv.proposedCommand ? "Accept" : "Acknowledge"}
                  </button>
                  {iv.proposedCommand && (iv.category === "plan_schedule" || iv.category === "plan_reschedule") && (
                    <button onClick={() => startEdit(iv)} disabled={busyId === iv.id}>Edit</button>
                  )}
                  <button onClick={() => resolve(iv.id, "dismiss")} disabled={busyId === iv.id}>Dismiss</button>
                </div>
              )}

              {isToday && editingId === iv.id && (
                <div className="reconcile-editor">
                  <label>
                    <span>New time</span>
                    <input type="datetime-local" value={editValue} onChange={e => setEditValue(e.target.value)} />
                  </label>
                  <div className="reconcile-actions">
                    <button onClick={() => saveEdit(iv)} disabled={busyId === iv.id || !editValue}>Save</button>
                    <button onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ marginTop: "12px", fontSize: "11px", color: "#f3a5a5" }}>{error}</div>}
    </section>
  )
}
