"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@life-os/ui"

export default function RegenerateButton({ personId }: { personId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function regenerate() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/persons/${personId}/theory/regenerate`, { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error?.message ?? body.error ?? "Failed to regenerate")
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to regenerate")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: "4px" }}>
      <Button
        variant="primary"
        size="sm"
        onClick={regenerate}
        disabled={busy}
        title="Synthesize a new versioned theory snapshot from the current graph"
        style={{ borderRadius: "100px", textTransform: "none", letterSpacing: 0 }}
      >
        {busy ? "Regenerating…" : "Regenerate theory"}
      </Button>
      {error && <span style={{ fontSize: "10px", color: "var(--attention)" }}>{error}</span>}
    </div>
  )
}
