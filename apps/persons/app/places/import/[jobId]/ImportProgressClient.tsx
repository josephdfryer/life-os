"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

type ImportJob = {
  id: string
  status: string
  filename: string
  totalRows: number
  processedRows: number
  createdRows: number
  stagedRows: number
  skippedRows: number
  errorRows: number
}

export default function ImportProgressClient({ initialJob }: { initialJob: ImportJob }) {
  const [job, setJob] = useState(initialJob)

  useEffect(() => {
    if (job.status === "done" || job.status === "failed") return
    const id = window.setInterval(async () => {
      const response = await fetch(`/api/import/${job.id}`)
      if (response.ok) setJob(await response.json())
    }, 1200)
    return () => window.clearInterval(id)
  }, [job.id, job.status])

  const progress = job.totalRows ? Math.round((job.processedRows / job.totalRows) * 100) : 0

  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "34px 24px 52px" }}>
      <Link href="/places" style={{ color: "var(--ink-3)", textDecoration: "none", fontSize: "12px" }}>← Places</Link>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "38px", marginBottom: "6px" }}>Import progress</h1>
      <p style={{ color: "var(--ink-3)" }}>{job.filename} · {job.status}</p>
      <div style={{ height: "12px", background: "var(--surface2)", borderRadius: "999px", overflow: "hidden", border: "1px solid var(--border)" }}>
        <div style={{ width: `${progress}%`, height: "100%", background: "var(--accent)", transition: "width 240ms ease" }} />
      </div>
      <div style={{ marginTop: "10px", color: "var(--ink-3)", fontSize: "12px" }}>{job.processedRows.toLocaleString()} / {job.totalRows.toLocaleString()} processed</div>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px", marginTop: "18px" }}>
        <Stat label="Created" value={job.createdRows} />
        <Stat label="Staged" value={job.stagedRows} />
        <Stat label="Skipped" value={job.skippedRows} />
        <Stat label="Errors" value={job.errorRows} />
      </section>
      {job.status === "done" && (
        <div style={{ display: "flex", gap: "10px", marginTop: "22px", flexWrap: "wrap" }}>
          <Link href={`/places/import/${job.id}/review`} style={buttonStyle}>Review staged visits</Link>
          <Link href="/places" style={{ ...buttonStyle, background: "transparent", color: "var(--accent)", border: "1px solid var(--accent)" }}>View map</Link>
        </div>
      )}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "16px", background: "var(--surface)" }}><div style={{ color: "var(--ink-3)", fontSize: "11px" }}>{label}</div><div style={{ fontFamily: "var(--font-display)", fontSize: "30px" }}>{value.toLocaleString()}</div></div>
}

const buttonStyle = { display: "inline-flex", borderRadius: "999px", padding: "11px 16px", background: "var(--accent)", color: "white", textDecoration: "none" }
