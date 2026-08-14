"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function FileActions({ fileId, archived }: { fileId: string; archived: boolean }) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  async function act(action: "archive" | "restore" | "reprocess") {
    setBusy(true)
    const response = await fetch(action === "reprocess" ? `/api/files/${fileId}/reprocess` : `/api/files/${fileId}`, { method: action === "reprocess" ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: action === "reprocess" ? undefined : JSON.stringify({ action }) })
    setBusy(false)
    if (response.ok) router.refresh()
  }
  return <div style={{ display: "flex", gap: 8 }}><a href={`/api/files/${fileId}/download`} style={button}>Download original</a>{!archived && <button disabled={busy} style={button} onClick={() => act("reprocess")}>Reprocess</button>}<button disabled={busy} style={button} onClick={() => act(archived ? "restore" : "archive")}>{archived ? "Restore" : "Archive"}</button></div>
}
const button: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: "7px 13px", background: "transparent", color: "var(--ink-3)", textDecoration: "none", font: "inherit", fontSize: "11px" }
