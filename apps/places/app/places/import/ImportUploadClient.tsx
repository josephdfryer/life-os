"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function ImportUploadClient() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<{ format: string; totalRows: number; firstStartedAt: string | null; lastStartedAt: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(nextFile: File | null) {
    setFile(nextFile)
    setPreview(null)
    setError(null)
    if (!nextFile) return
    const form = new FormData()
    form.append("file", nextFile)
    const response = await fetch("/api/import", { method: "PUT", body: form })
    const payload = await response.json()
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not read this export")
      return
    }
    setPreview(payload)
  }

  async function startImport() {
    if (!file) return
    setBusy(true)
    setError(null)
    const form = new FormData()
    form.append("file", file)
    const response = await fetch("/api/import", { method: "POST", body: form })
    const payload = await response.json()
    setBusy(false)
    if (!response.ok) {
      setError(payload?.error?.message ?? "Import failed")
      return
    }
    router.push(`/places/import/${payload.id}`)
  }

  return (
    <div className="import-page" style={{ padding: "34px 24px 52px" }}>
      <main style={{ maxWidth: "980px", margin: "0 auto" }}>
        <a href="/places" style={{ color: "var(--ink-2)", textDecoration: "none", fontSize: "12px" }}>← Back to Places</a>
        <header style={{ marginTop: "22px", marginBottom: "24px" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "44px", lineHeight: 1, margin: 0 }}>Import Google Maps Timeline</h1>
          <p style={{ maxWidth: "680px", color: "var(--ink-2)", fontSize: "14px" }}>
            Bring legacy Takeout or on-device Timeline exports into your private Places graph. High-confidence visits become Place and Event nodes; ambiguous ones wait here for review.
          </p>
        </header>

        <section
          onDragOver={event => event.preventDefault()}
          onDrop={event => { event.preventDefault(); void choose(event.dataTransfer.files[0] ?? null) }}
          style={{
            border: "1px dashed var(--accent)",
            borderRadius: "18px",
            padding: "34px",
            background: "linear-gradient(135deg, rgba(212,106,58,0.14), rgba(255,255,255,0.03))",
            minHeight: "240px",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
          }}
        >
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "24px", marginBottom: "10px" }}>Drop a `.json` or `.zip` export</div>
            <p style={{ color: "var(--ink-2)", margin: "0 0 18px" }}>Legacy monthly Takeout zips are supported, as are newer `Timeline.json` files.</p>
            <label style={{ display: "inline-flex", cursor: "pointer", border: "1px solid var(--border)", borderRadius: "999px", padding: "10px 16px", background: "var(--surface)", color: "var(--ink)" }}>
              Choose file
              <input type="file" accept=".json,.zip,application/json,application/zip" hidden onChange={event => void choose(event.target.files?.[0] ?? null)} />
            </label>
          </div>
        </section>

        {error && <p style={{ color: "#ffb199" }}>{error}</p>}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "14px", marginTop: "18px" }}>
          <OptionCard title="Date range" value="Last 5 years default" />
          <OptionCard title="Auto-create" value="70% confidence" />
          <OptionCard title="Review floor" value="30% confidence" />
        </section>

        {preview && (
          <section style={{ marginTop: "18px", border: "1px solid var(--border)", borderRadius: "16px", padding: "18px", background: "var(--surface)" }}>
            <div style={{ color: "var(--ink-2)", fontSize: "12px" }}>Detected {preview.format.replace("_", " ")}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "28px" }}>Found {preview.totalRows.toLocaleString()} place visits</div>
            <div style={{ color: "var(--ink-2)", fontSize: "12px" }}>{dateLabel(preview.firstStartedAt)} → {dateLabel(preview.lastStartedAt)}</div>
            <button onClick={startImport} disabled={busy} style={{ marginTop: "16px", border: 0, borderRadius: "999px", padding: "12px 18px", background: "var(--accent)", color: "white", cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
              {busy ? "Importing..." : "Import into Life OS"}
            </button>
          </section>
        )}
      </main>
    </div>
  )
}

function OptionCard({ title, value }: { title: string; value: string }) {
  return <div style={{ border: "1px solid var(--border)", borderRadius: "14px", padding: "14px", background: "rgba(255,255,255,0.03)" }}><div style={{ color: "var(--ink-3)", fontSize: "11px" }}>{title}</div><div>{value}</div></div>
}

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "unknown"
}
