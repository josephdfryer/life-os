"use client"

import { useEffect, useRef, useState } from "react"
import { uploadFile } from "@/lib/upload"

const STAGE_LABEL = { hashing: "Hashing", authorizing: "Authorizing", uploading: "Uploading", verifying: "Verifying" } as const

type FileRow = {
  id: string
  filename: string
  sizeBytes: number
  mimeType: string | null
  processingState: string
  createdAt: string
  _count: { chunks: number; entityMentions: number; evidenceClaims: number }
  processingRuns: Array<{ id: string; status: string; summary: string | null; error: string | null }>
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileRow[]>([])
  const [status, setStatus] = useState("")
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [storeOnly, setStoreOnly] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function refresh() {
    const response = await fetch("/api/files")
    if (response.ok) {
      const payload = await response.json()
      setFiles(payload.files ?? [])
      setNextCursor(payload.nextCursor ?? null)
    }
  }
  useEffect(() => { refresh().catch(() => {}) }, [])

  async function upload(file: File) {
    await uploadFile(file, {
      storeOnly,
      onProgress: (stage, filename) => setStatus(`${STAGE_LABEL[stage]} ${filename}…`),
    })
    setStatus(`${file.name} is queued for processing.`)
    await refresh()
  }

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = [...(event.target.files ?? [])]
    try {
      for (const file of chosen) await upload(file)
    } catch (error) { setStatus(error instanceof Error ? error.message : "Upload failed") }
    finally { if (input.current) input.current.value = "" }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const response = await fetch(`/api/files?cursor=${encodeURIComponent(nextCursor)}`)
      if (!response.ok) return
      const payload = await response.json()
      setFiles(current => [...current, ...(payload.files ?? [])])
      setNextCursor(payload.nextCursor ?? null)
    } finally { setLoadingMore(false) }
  }

  return <main style={{ maxWidth: "1000px", margin: "0 auto", padding: "32px 24px" }}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "28px" }}>
      <div><h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "30px", margin: 0 }}>Files</h1><p style={{ color: "var(--ink-3)", margin: "4px 0 0", fontSize: "13px" }}>Private source material, cited all the way into the graph.</p></div>
      <nav style={{ display: "flex", gap: "8px" }}><a href="/" className="ghost-link">Chat</a><button className="primary-button" onClick={() => input.current?.click()}>Upload files</button></nav>
    </header>
    <input ref={input} hidden type="file" multiple onChange={choose} />
    <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", color: "var(--ink-3)", marginBottom: "12px" }}><input type="checkbox" checked={storeOnly} onChange={event => setStoreOnly(event.target.checked)} /> Store only — preserve originals without extraction</label>
    {status && <div style={{ padding: "10px 14px", borderRadius: "var(--radius)", background: "var(--camel-soft)", color: "var(--ink-2)", fontSize: "12px", marginBottom: "16px" }}>{status}</div>}
    <div style={{ display: "grid", gap: "10px" }}>
      {files.map(file => <a key={file.id} href={`/files/${file.id}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "16px", padding: "16px 18px", background: "var(--surface)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)", borderRadius: "var(--radius)", textDecoration: "none" }}>
        <div><div style={{ fontFamily: "var(--font-display)", fontSize: "17px" }}>{file.filename}</div><div style={{ color: "var(--ink-3)", fontSize: "11px", marginTop: "4px" }}>{formatBytes(file.sizeBytes)} · {file._count.chunks} passages · {file._count.entityMentions} mentions · {file._count.evidenceClaims} claims</div></div>
        <span style={{ alignSelf: "center", padding: "3px 10px", borderRadius: "var(--radius-pill)", background: stateColor(file.processingState), color: "var(--cognac-deep)", fontSize: "11px" }}>{file.processingState.replaceAll("_", " ")}</span>
      </a>)}
      {!files.length && <div style={{ padding: "50px", textAlign: "center", color: "var(--ink-3)", background: "var(--surface)", borderRadius: "var(--radius)" }}>No files yet. Upload one to begin.</div>}
    </div>
    {nextCursor ? <button type="button" disabled={loadingMore} className="ghost-link" style={{ display: "block", margin: "18px auto 0", background: "transparent" }} onClick={loadMore}>{loadingMore ? "Loading…" : "Load more files"}</button> : null}
    <style>{`.primary-button,.ghost-link{border-radius:var(--radius-pill);padding:9px 16px;font:inherit;font-size:12px;text-decoration:none}.primary-button{background:var(--cognac);color:white;border:0}.ghost-link{border:1px solid var(--border);color:var(--ink-3)}`}</style>
  </main>
}

function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB` }
function stateColor(state: string) { return state === "ready" ? "var(--cognac-soft)" : state === "failed" ? "var(--attention-soft)" : "var(--camel-soft)" }
