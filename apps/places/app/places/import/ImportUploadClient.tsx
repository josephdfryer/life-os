"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTimeZone } from "@life-os/ui"

export default function ImportUploadClient() {
  const router = useRouter()
  const tz = useTimeZone()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(nextFile: File | null) {
    setFile(nextFile)
    setPreview(null)
    setError(null)
    if (!nextFile) return
    setBusy(true)
    const form = new FormData()
    form.append("file", nextFile)
    const response = await fetch("/api/import", { method: "PUT", body: form })
    const payload = await response.json()
    setBusy(false)
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
            Preview a Google Timeline export before writing anything to LifeOS. This pass reads visits only and ignores movement paths.
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
            <p style={{ color: "var(--ink-2)", margin: "0 0 18px" }}>Legacy Takeout, on-device Timeline, and newer flat location-history JSON files are supported.</p>
            <label style={{ display: "inline-flex", cursor: "pointer", border: "1px solid var(--border)", borderRadius: "999px", padding: "10px 16px", background: "var(--surface)", color: "var(--ink)" }}>
              Choose file
              <input type="file" accept=".json,.zip,application/json,application/zip" hidden onChange={event => void choose(event.target.files?.[0] ?? null)} />
            </label>
          </div>
        </section>

        {error && <p style={{ color: "#ffb199" }}>{error}</p>}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "14px", marginTop: "18px" }}>
          <OptionCard title="Mode" value="Preview only" />
          <OptionCard title="Auto-create estimate" value="70% confidence" />
          <OptionCard title="Review estimate" value="30% confidence" />
        </section>

        {preview && (
          <section style={{ marginTop: "18px", border: "1px solid var(--border)", borderRadius: "16px", padding: "18px", background: "var(--surface)" }}>
            <div style={{ color: "var(--ink-2)", fontSize: "12px" }}>Detected {preview.format.replaceAll("_", " ")}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "28px" }}>Found {preview.totalVisits.toLocaleString()} visits</div>
            <div style={{ color: "var(--ink-2)", fontSize: "12px" }}>{dateLabel(preview.firstStartedAt, tz)} → {dateLabel(preview.lastStartedAt, tz)}</div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px", marginTop: "18px" }}>
              <Metric label="Source records" value={preview.totalRecords.toLocaleString()} />
              <Metric label="Ignored movement/path" value={preview.ignoredRecords.toLocaleString()} />
              <Metric label="Google place IDs" value={preview.uniqueGooglePlaceIds.toLocaleString()} />
              <Metric label="Avg visit" value={preview.averageVisitMinutes === null ? "unknown" : `${Math.round(preview.averageVisitMinutes)}m`} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "10px", marginTop: "10px" }}>
              <Metric label="Would auto-create" value={preview.estimatedAutoCreateRows.toLocaleString()} />
              <Metric label="Would stage" value={preview.estimatedStagedRows.toLocaleString()} />
              <Metric label="Would skip" value={preview.estimatedSkippedRows.toLocaleString()} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginTop: "18px" }}>
              <SummaryList title="Record types" items={Object.entries(preview.sourceRecordTypes).map(([label, count]) => ({ label, count }))} />
              <SummaryList title="Semantic types" items={preview.topSemanticTypes} />
            </div>

            <div style={{ marginTop: "18px", color: "var(--ink-2)", fontSize: "12px" }}>
              Nothing has been written yet. Importing will create high-confidence named Places and Events, then stage ambiguous visits for review.
            </div>
            <button onClick={startImport} disabled={busy || !file} style={{ marginTop: "16px", border: 0, borderRadius: "999px", padding: "12px 18px", background: "var(--accent)", color: "white", cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
              {busy ? "Importing..." : "Import this file"}
            </button>
          </section>
        )}
      </main>
    </div>
  )
}

type ImportPreview = {
  format: string
  totalRecords: number
  totalVisits: number
  ignoredRecords: number
  firstStartedAt: string | null
  lastStartedAt: string | null
  uniqueGooglePlaceIds: number
  estimatedAutoCreateRows: number
  estimatedStagedRows: number
  estimatedSkippedRows: number
  averageVisitMinutes: number | null
  sourceRecordTypes: Record<string, number>
  topSemanticTypes: Array<{ label: string; count: number }>
}

function OptionCard({ title, value }: { title: string; value: string }) {
  return <div style={{ border: "1px solid var(--border)", borderRadius: "14px", padding: "14px", background: "rgba(255,255,255,0.03)" }}><div style={{ color: "var(--ink-3)", fontSize: "11px" }}>{title}</div><div>{value}</div></div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "12px", background: "rgba(255,255,255,0.04)" }}><div style={{ color: "var(--ink-3)", fontSize: "10px" }}>{label}</div><div style={{ fontSize: "18px" }}>{value}</div></div>
}

function SummaryList({ title, items }: { title: string; items: Array<{ label: string; count: number }> }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "12px" }}>
      <div style={{ color: "var(--ink-3)", fontSize: "11px", marginBottom: "8px" }}>{title}</div>
      {items.length === 0 ? <div style={{ color: "var(--ink-3)" }}>None</div> : items.slice(0, 8).map(item => (
        <div key={item.label} style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "12px", padding: "3px 0" }}>
          <span>{item.label}</span>
          <span style={{ color: "var(--ink-2)" }}>{item.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function dateLabel(value: string | null, timeZone?: string) {
  return value ? new Date(value).toLocaleDateString("en-US", { timeZone }) : "unknown"
}
