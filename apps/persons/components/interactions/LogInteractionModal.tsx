"use client"

import { useState } from "react"

type Props = {
  personId: string
  personName: string
  onClose: () => void
  onSaved: () => void
}

const INTERACTION_TYPES = ["call", "meeting", "message", "email", "dinner", "in-person", "other"]
const EMOTIONAL_WEIGHTS = ["Energizing", "Positive", "Neutral", "Draining", "Stressful"]
const OUTCOMES = ["Complete", "Follow-up needed", "Action required", "Open"]

export default function LogInteractionModal({ personId, personName, onClose, onSaved }: Props) {
  const today = new Date().toISOString().split("T")[0]
  const [form, setForm] = useState({
    type: "call",
    timestamp: today,
    duration: "",
    summary: "",
    notes: "",
    emotionalWeight: "Neutral",
    outcome: "Complete",
    actionItems: "",
    billable: false,
    amount: "",
    direction: "outflow",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const actionItems = form.actionItems
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean)
    const res = await fetch("/api/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId,
        ...form,
        timestamp: new Date(form.timestamp).toISOString(),
        duration: form.duration ? parseInt(form.duration) : null,
        amount: form.amount ? parseFloat(form.amount) : null,
        actionItems,
      }),
    })
    setLoading(false)
    if (!res.ok) {
      setError("Failed to save. Please try again.")
      return
    }
    onSaved()
  }

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(26,24,20,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal-panel"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "28px",
          width: "100%",
          maxWidth: "520px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
          <h2 style={{ fontFamily: "var(--font-display), serif", fontSize: "20px", fontWeight: 600, margin: 0, color: "var(--ink)" }}>
            Log Interaction with {personName}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: "18px", padding: "4px" }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Type chips */}
          <div>
            <label style={labelStyle}>Type</label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
              {INTERACTION_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("type", t)}
                  style={chipStyle(form.type === t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={labelStyle}>Date</label>
              <input
                type="date"
                value={form.timestamp}
                onChange={e => set("timestamp", e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Duration (min)</label>
              <input
                type="number"
                value={form.duration}
                onChange={e => set("duration", e.target.value)}
                placeholder="30"
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Summary</label>
            <textarea
              value={form.summary}
              onChange={e => set("summary", e.target.value)}
              placeholder="Brief summary of what happened…"
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder="Additional notes…"
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <div>
            <label style={labelStyle}>Emotional weight</label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
              {EMOTIONAL_WEIGHTS.map(w => (
                <button key={w} type="button" onClick={() => set("emotionalWeight", w)} style={chipStyle(form.emotionalWeight === w)}>
                  {w}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Outcome</label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
              {OUTCOMES.map(o => (
                <button key={o} type="button" onClick={() => set("outcome", o)} style={chipStyle(form.outcome === o)}>
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Action items (one per line)</label>
            <textarea
              value={form.actionItems}
              onChange={e => set("actionItems", e.target.value)}
              placeholder="Send follow-up email&#10;Schedule next meeting"
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <div>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.billable}
                onChange={e => set("billable", e.target.checked)}
                style={{ accentColor: "var(--accent)", width: "14px", height: "14px" }}
              />
              <span style={{ ...labelStyle, margin: 0 }}>Billable</span>
            </label>
          </div>

          {form.billable && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={labelStyle}>Amount</label>
                <input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="500" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Direction</label>
                <select value={form.direction} onChange={e => set("direction", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                  <option value="inflow">Inflow</option>
                  <option value="outflow">Outflow</option>
                </select>
              </div>
            </div>
          )}

          {error && <p style={{ color: "var(--accent)", fontSize: "12px", margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" disabled={loading} style={submitBtnStyle}>{loading ? "Saving…" : "Log Interaction"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  color: "var(--ink-3)",
  fontSize: "10px",
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontSize: "12px",
  marginTop: "5px",
}

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: "5px 12px",
  borderRadius: "20px",
  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
  background: active ? "var(--accent-soft)" : "var(--surface2)",
  color: active ? "var(--accent)" : "var(--ink-3)",
  fontSize: "11px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: active ? 500 : 400,
})

const cancelBtnStyle: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: "7px",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--ink-2)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "12px",
}

const submitBtnStyle: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: "7px",
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "12px",
  fontWeight: 500,
}
