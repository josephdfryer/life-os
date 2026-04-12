"use client"

import { useState } from "react"

type Props = {
  personId: string
  personName: string
  onClose: () => void
  onSaved: () => void
}

export default function AddPlanModal({ personId, personName, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    text: "",
    timescale: "",
    successSignals: "",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.text.trim()) {
      setError("Plan description is required.")
      return
    }
    setLoading(true)
    setError(null)
    const successSignals = form.successSignals
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean)
    const res = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId, ...form, successSignals }),
    })
    setLoading(false)
    if (!res.ok) {
      setError("Failed to save.")
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
          maxWidth: "440px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
          <h2 style={{ fontFamily: "var(--font-playfair), serif", fontSize: "20px", fontWeight: 600, margin: 0, color: "var(--ink)" }}>
            Add Plan for {personName}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: "18px", padding: "4px" }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={labelStyle}>Plan *</label>
            <textarea
              value={form.text}
              onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
              placeholder="Help Marcus navigate the Series A raise…"
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
          <div>
            <label style={labelStyle}>Timescale</label>
            <input
              type="text"
              value={form.timescale}
              onChange={e => setForm(f => ({ ...f, timescale: e.target.value }))}
              placeholder="Q2 2026, 6 months, ongoing…"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Success signals (one per line)</label>
            <textarea
              value={form.successSignals}
              onChange={e => setForm(f => ({ ...f, successSignals: e.target.value }))}
              placeholder="Intro made to 3 investors&#10;Term sheet received"
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          {error && <p style={{ color: "var(--accent)", fontSize: "12px", margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" disabled={loading} style={submitBtnStyle}>{loading ? "Saving…" : "Add Plan"}</button>
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
