"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"

type Kind = "calendar" | "gmail" | "meetings" | "era" | "oura"
type Connection = { id: string; kind: string; provider: string; accountEmail: string | null; label: string | null; status: string; lastSyncedAt: string | null; lastError: string | null; actions: string[] }

const KIND_MARK: Record<Kind, string> = { calendar: "31", gmail: "@", meetings: "G", era: "$", oura: "O" }

const INTEGRATIONS: Array<{ kind: Kind; name: string; description: string; href: string; cta: string }> = [
  { kind: "calendar", name: "Google Calendar", description: "Events, attendance, and the shape of your time.", href: "https://events.lacollecteur.com/settings/calendar", cta: "Manage calendars" },
  { kind: "gmail", name: "Gmail", description: "Messages and relationship history, matched conservatively.", href: "https://persons.lacollecteur.com/api/gmail/google/connect", cta: "Connect Gmail" },
  { kind: "meetings", name: "Granola", description: "Meeting summaries, transcripts, People, and company context.", href: "https://events.lacollecteur.com/settings/granola", cta: "Manage Granola" },
  { kind: "era", name: "Era", description: "Accounts and financial activity, with source provenance.", href: "", cta: "Connect Era" },
  { kind: "oura", name: "Oura", description: "Readiness, sleep score, activity score, and stress — Oura's numbers, not Apple Health.", href: "/connections/oura/connect", cta: "Connect Oura" },
]

const OURA_STATUS: Record<string, string> = {
  connected: "Oura is connected. The last 35 days are in the graph.",
  connected_sync_failed: "Oura is connected, but the first import did not finish. Use Sync now.",
  denied: "Oura access was declined.",
  scope: "Oura did not grant Daily access. Reconnect and leave Daily enabled.",
  not_configured: "Oura is not configured yet. Add the API application credentials.",
  authorize_failed: "Oura could not start authorization.",
  callback_failed: "Oura authorization did not complete.",
  invalid: "Oura returned an incomplete callback.",
  unavailable: "The connections service was unavailable.",
}

export function ConnectionsClient() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ouraStatus, setOuraStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const response = await fetch("/api/connections/list", { cache: "no-store" })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || "Connections could not be loaded.")
      setConnections(Array.isArray(body.connections) ? body.connections : [])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connections could not be loaded.")
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("oura")
    if (value && OURA_STATUS[value]) setOuraStatus(OURA_STATUS[value])
  }, [])

  return <section className="connections-grid" aria-live="polite">
    {ouraStatus && <div className="stream-message connections-wide" role="status"><strong>Oura</strong><span>{ouraStatus}</span></div>}
    {error && <div className="stream-message stream-message-error connections-wide" role="alert"><strong>Connection status is unavailable.</strong><span>{error}</span><button className="still-button still-button-secondary" onClick={load}>Try again</button></div>}
    {INTEGRATIONS.map(integration => <ConnectionCard integration={integration} rows={connections.filter(row => row.kind === integration.kind)} loading={loading} reload={load} key={integration.kind} />)}
  </section>
}

function ConnectionCard({ integration, rows, loading, reload }: { integration: typeof INTEGRATIONS[number]; rows: Connection[]; loading: boolean; reload: () => Promise<void> }) {
  const healthy = rows.filter(row => row.status === "active" && !row.lastError).length
  const needsAttention = rows.some(row => row.status !== "active" || row.lastError)
  const [showEraForm, setShowEraForm] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const disconnect = async (id: string) => {
    setBusyId(id); setActionError(null)
    try {
      const response = await fetch(`/api/connections/${id}`, { method: "DELETE" })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || "Connection could not be disconnected.")
      await reload()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Connection could not be disconnected.")
    } finally { setBusyId(null) }
  }

  const syncOura = async () => {
    setBusyId("oura-sync"); setActionError(null)
    try {
      const response = await fetch("/api/connections/oura/sync", { method: "POST" })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || "Oura could not be synced.")
      await reload()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Oura could not be synced.")
    } finally { setBusyId(null) }
  }

  return <article className={needsAttention ? "connection-card connection-card-attention" : "connection-card"}>
    <div className="connection-card-heading"><div><span className={`connection-kind connection-kind-${integration.kind}`} aria-hidden>{KIND_MARK[integration.kind]}</span><div><h2>{integration.name}</h2><p>{integration.description}</p></div></div><span className={needsAttention ? "integration-status integration-status-error" : healthy ? "integration-status integration-status-active" : "integration-status"}>{loading ? "Checking…" : needsAttention ? "Needs attention" : healthy ? `${healthy} active` : "Not connected"}</span></div>
    <div className="connection-accounts">{loading ? <div className="connection-account-placeholder">Loading account status…</div> : rows.length === 0 ? <div className="connection-account-placeholder">No {integration.name} account connected yet.</div> : rows.map(row => <div className="connection-account" key={row.id}><div><strong>{row.label || row.accountEmail || "Unnamed account"}</strong><span>{row.accountEmail && row.label ? row.accountEmail : row.provider}</span></div><div><span>{row.lastError || (row.lastSyncedAt ? `Last synced ${formatRelative(row.lastSyncedAt)}` : "Not synced yet")}</span><small>{row.status}</small>{integration.kind === "oura" && row.status === "active" && row.actions.includes("sync") && <button className="connection-text-action" disabled={busyId !== null} onClick={() => void syncOura()}>{busyId === "oura-sync" ? "Syncing…" : "Sync now"}</button>}{integration.kind !== "meetings" && row.status === "active" && row.actions.includes("disconnect") && <button className="connection-text-action" disabled={busyId === row.id} onClick={() => void disconnect(row.id)}>{busyId === row.id ? "Disconnecting…" : "Disconnect"}</button>}</div></div>)}</div>
    {actionError && <p className="connection-action-error" role="alert">{actionError}</p>}
    {showEraForm && <EraConnectionForm onConnected={async () => { setShowEraForm(false); await reload() }} onCancel={() => setShowEraForm(false)} />}
    <div className="connection-card-actions">{integration.kind === "era" ? <button className="still-button still-button-primary" onClick={() => setShowEraForm(value => !value)}>{rows.length ? "Reconnect Era" : integration.cta}</button> : <a className="still-button still-button-primary" href={integration.href}>{rows.length ? integration.cta.replace("Connect", "Reconnect") : integration.cta}</a>}{rows.length > 0 && <span>{rows.reduce((sum, row) => sum + row.actions.length, 0)} available actions</span>}</div>
  </article>
}

function EraConnectionForm({ onConnected, onCancel }: { onConnected: () => Promise<void>; onCancel: () => void }) {
  const [apiKey, setApiKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      const response = await fetch("/api/connections/era", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || "Era could not be connected.")
      setApiKey("")
      await onConnected()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Era could not be connected.")
    } finally { setBusy(false) }
  }

  return <form className="connection-era-form" onSubmit={submit}>
    <label htmlFor="era-api-key">Era API key</label>
    <input id="era-api-key" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} required />
    <small>The key is encrypted before it is stored. It is never returned by the Connections API.</small>
    {error && <p className="connection-action-error" role="alert">{error}</p>}
    <div><button className="still-button still-button-primary" disabled={busy}>{busy ? "Connecting…" : "Save connection"}</button><button type="button" className="still-button still-button-secondary" onClick={onCancel}>Cancel</button></div>
  </form>
}

function formatRelative(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
