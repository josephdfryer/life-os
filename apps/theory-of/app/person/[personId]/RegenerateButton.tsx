"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function RegenerateButton({ personId }: { personId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function regenerate() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/theory/${personId}/regenerate`, { method: "POST" })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to regenerate")
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to regenerate")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: "4px" }}>
      <button
        onClick={regenerate}
        disabled={busy}
        title="Synthesize a new versioned theory snapshot from the current graph"
        style={{
          padding: "7px 14px",
          borderRadius: "8px",
          fontSize: "12px",
          fontWeight: 500,
          fontFamily: "inherit",
          color: "var(--bg)",
          background: "var(--ink)",
          border: "none",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          transition: "opacity 0.1s",
        }}
      >
        {busy ? "Regenerating…" : "Regenerate Theory"}
      </button>
      {error && <span style={{ fontSize: "10px", color: "var(--accent)" }}>{error}</span>}
    </div>
  )
}
