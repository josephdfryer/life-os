"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function AddTheoryNote({ personId, personName }: { personId: string; personName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!body.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/theory/${personId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save note")
      setBody("")
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save note")
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Capture an observation as a normal Life OS Note"
        style={ghostButtonStyle}
      >
        Add Theory Note
      </button>
    )
  }

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "10px",
      padding: "14px",
      width: "100%",
      maxWidth: "440px",
    }}>
      <div style={{ fontSize: "11px", color: "var(--ink-3)", marginBottom: "8px" }}>
        Observation about {personName}. Saved as a normal Note (type <code>theory_observation</code>) — not a theory primitive.
      </div>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={4}
        autoFocus
        placeholder="What did you observe?"
        style={{
          width: "100%",
          resize: "vertical",
          padding: "10px",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--ink)",
          fontFamily: "inherit",
          fontSize: "12px",
          lineHeight: 1.5,
        }}
      />
      {error && <div style={{ fontSize: "10px", color: "var(--accent)", marginTop: "6px" }}>{error}</div>}
      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
        <button onClick={submit} disabled={busy || !body.trim()} style={{
          padding: "6px 12px",
          borderRadius: "8px",
          fontSize: "12px",
          fontWeight: 500,
          fontFamily: "inherit",
          color: "var(--bg)",
          background: "var(--ink)",
          border: "none",
          cursor: busy || !body.trim() ? "default" : "pointer",
          opacity: busy || !body.trim() ? 0.6 : 1,
        }}>
          {busy ? "Saving…" : "Save note"}
        </button>
        <button onClick={() => { setOpen(false); setError(null) }} style={ghostButtonStyle}>
          Cancel
        </button>
      </div>
    </div>
  )
}

const ghostButtonStyle: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: "8px",
  fontSize: "12px",
  fontWeight: 500,
  fontFamily: "inherit",
  color: "var(--ink-2)",
  background: "transparent",
  border: "1px solid var(--border)",
  cursor: "pointer",
}
