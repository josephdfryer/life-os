"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@life-os/ui"

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
      const res = await fetch(`/api/persons/${personId}/theory/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error?.message ?? payload.error ?? "Failed to save note")
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
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        title="Capture an observation as a Life OS Note about this person"
        style={{ borderRadius: "100px", textTransform: "none", letterSpacing: 0 }}
      >
        Add observation
      </Button>
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
        Observation about {personName}. Saved as a Note tagged to them — not a theory primitive.
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
      {error && <div style={{ fontSize: "10px", color: "var(--attention)", marginTop: "6px" }}>{error}</div>}
      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={busy || !body.trim()}
          style={{ borderRadius: "100px", textTransform: "none", letterSpacing: 0 }}
        >
          {busy ? "Saving…" : "Save note"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setOpen(false); setError(null) }}
          style={{ borderRadius: "100px", textTransform: "none", letterSpacing: 0 }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
