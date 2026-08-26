"use client"

import { useState } from "react"

type GranolaStatus = {
  connected: boolean
  status?: string
  label?: string | null
  lastSyncedAt?: string | null
  lastError?: string | null
  scope?: string | null
  metadata?: {
    importedCount?: number
    lastRun?: { imported: number; updated: number; failed: number; finishedAt: string }
  }
}

export default function GranolaSettingsClient({ initialStatus }: { initialStatus: GranolaStatus }) {
  const [status, setStatus] = useState(initialStatus)
  const [apiKey, setApiKey] = useState("")
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refreshStatus() {
    const response = await fetch("/api/granola/status", { cache: "no-store" })
    const data = await response.json()
    if (!response.ok) throw new Error(readError(data, "Could not load Granola status"))
    setStatus(data)
  }

  async function connect() {
    if (!apiKey.trim()) return
    setBusy("connect")
    setError(null)
    setMessage(null)
    try {
      const response = await fetch("/api/granola/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(readError(data, "Could not connect Granola"))
      setApiKey("")
      setMessage("Connected. Run the initial backfill to import every accessible meeting.")
      await refreshStatus()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect Granola")
    } finally {
      setBusy(null)
    }
  }

  async function sync(fullBackfill: boolean) {
    setBusy("sync")
    setError(null)
    setMessage(null)
    try {
      const response = await fetch("/api/granola/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullBackfill }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(readError(data, "Granola sync failed"))
      setMessage(`Sync complete: ${data.imported} new, ${data.updated} updated, ${data.failed} failed.`)
      await refreshStatus()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Granola sync failed")
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Granola? Imported Events, summaries, transcripts, and Person links will be kept.")) return
    setBusy("disconnect")
    setError(null)
    try {
      const response = await fetch("/api/granola/disconnect", { method: "POST" })
      const data = await response.json()
      if (!response.ok) throw new Error(readError(data, "Could not disconnect Granola"))
      setStatus({ connected: false, status: "disabled" })
      setMessage("Granola disconnected. Existing meeting data was kept.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disconnect Granola")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      {error ? <div role="alert" style={errorStyle}>{error}</div> : null}
      {message ? <div role="status" style={successStyle}>{message}</div> : null}

      <section style={panelStyle}>
        <div style={eyebrowStyle}>Connection</div>
        <h2 style={headingStyle}>{status.connected ? "Granola is connected" : "Connect Granola"}</h2>
        <p style={copyStyle}>
          LifeOS reads meeting notes from your active Granola workspace. The API key is encrypted at rest and is never sent back to this page.
        </p>

        {status.connected ? (
          <div style={{ display: "grid", gap: "10px", marginTop: "18px" }}>
            <StatusRow label="Scope" value={status.scope ?? "Personal and public notes"} />
            <StatusRow label="Imported" value={`${status.metadata?.importedCount ?? 0} meetings`} />
            <StatusRow label="Last successful sync" value={formatDate(status.lastSyncedAt)} />
            {status.lastError ? <div role="alert" style={warningStyle}>{status.lastError}</div> : null}
          </div>
        ) : (
          <div style={{ marginTop: "20px" }}>
            <label htmlFor="granola-api-key" style={labelStyle}>Rotated Granola API key</label>
            <input
              id="granola-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="grn_…"
              style={inputStyle}
            />
            <p style={helpStyle}>Revoke the key previously pasted into chat, then enter a newly generated key here.</p>
            <button type="button" onClick={connect} disabled={busy !== null || !apiKey.trim()} style={primaryButtonStyle}>
              {busy === "connect" ? "Validating…" : "Connect securely"}
            </button>
          </div>
        )}
      </section>

      {status.connected ? (
        <section style={panelStyle}>
          <div style={eyebrowStyle}>Import</div>
          <h2 style={headingStyle}>Daily meeting sync</h2>
          <p style={copyStyle}>
            Each morning, LifeOS imports new and edited summaries and full transcripts, links exact-email attendees to People, and stages uncertain identities for review.
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "20px" }}>
            <button type="button" onClick={() => sync(false)} disabled={busy !== null} style={primaryButtonStyle}>
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" onClick={() => sync(true)} disabled={busy !== null} style={secondaryButtonStyle}>
              Import all history
            </button>
            <button type="button" onClick={disconnect} disabled={busy !== null} style={quietButtonStyle}>
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: "20px", padding: "9px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: "13px" }}><span style={{ color: "var(--ink-3)" }}>{label}</span><span>{value}</span></div>
}

function readError(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback
  const value = data as { error?: string | { message?: string } }
  return typeof value.error === "string" ? value.error : value.error?.message ?? fallback
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not yet"
}

const panelStyle: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", padding: "24px" }
const eyebrowStyle: React.CSSProperties = { color: "var(--cognac)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }
const headingStyle: React.CSSProperties = { fontFamily: "var(--font-display)", fontSize: "22px", fontWeight: 500, margin: "5px 0 8px" }
const copyStyle: React.CSSProperties = { color: "var(--ink-3)", fontSize: "13px", lineHeight: 1.65, margin: 0, maxWidth: "620px" }
const labelStyle: React.CSSProperties = { display: "block", fontSize: "12px", color: "var(--ink-2)", marginBottom: "7px" }
const inputStyle: React.CSSProperties = { width: "100%", padding: "11px 12px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", fontFamily: "var(--font-body)", fontSize: "14px", outline: "none" }
const helpStyle: React.CSSProperties = { color: "var(--ink-4)", fontSize: "11px", margin: "7px 0 14px" }
const primaryButtonStyle: React.CSSProperties = { border: 0, borderRadius: "var(--radius-pill)", background: "var(--cognac)", color: "white", padding: "9px 16px", font: "inherit", fontSize: "12px", cursor: "pointer" }
const secondaryButtonStyle: React.CSSProperties = { ...primaryButtonStyle, background: "var(--surface)", color: "var(--cognac-deep)", border: "1px solid var(--cognac)" }
const quietButtonStyle: React.CSSProperties = { ...primaryButtonStyle, background: "transparent", color: "var(--ink-4)", border: "1px solid var(--border)" }
const errorStyle: React.CSSProperties = { border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", borderRadius: "var(--radius-control)", padding: "12px 14px", fontSize: "12px" }
const warningStyle: React.CSSProperties = { border: "1px solid var(--warning)", background: "var(--warning-soft)", color: "var(--ink-2)", borderRadius: "var(--radius-control)", padding: "12px", fontSize: "12px", whiteSpace: "pre-wrap" }
const successStyle: React.CSSProperties = { border: "1px solid var(--success)", background: "var(--success-soft)", color: "var(--ink-2)", borderRadius: "var(--radius-control)", padding: "12px 14px", fontSize: "12px" }
