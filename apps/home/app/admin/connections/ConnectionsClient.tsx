"use client"

import { lifeOsAppUrl } from "@life-os/auth/urls"
import { FormEvent, useCallback, useEffect, useState } from "react"

type Kind = "calendar" | "gmail" | "meetings" | "era" | "oura"
type Connection = { id: string; kind: string; provider: string; accountEmail: string | null; label: string | null; status: string; lastSyncedAt: string | null; lastError: string | null; actions: string[] }

const KIND_MARK: Record<Kind, string> = { calendar: "31", gmail: "@", meetings: "G", era: "$", oura: "O" }

const EVENTS_URL = lifeOsAppUrl("events", "http://localhost:3006")

const INTEGRATIONS: Array<{ kind: Kind; name: string; description: string; href: string; cta: string }> = [
  { kind: "calendar", name: "Google Calendar", description: "Events, attendance, and the shape of your time.", href: "/admin/connections/google/calendar/connect", cta: "Connect Calendar" },
  { kind: "gmail", name: "Gmail", description: "Messages and relationship history, matched conservatively.", href: "/admin/connections/google/gmail/connect", cta: "Connect Gmail" },
  { kind: "meetings", name: "Granola", description: "Meeting summaries, transcripts, People, and company context.", href: "", cta: "Connect Granola" },
  { kind: "era", name: "Era", description: "Accounts and financial activity, with source provenance.", href: "", cta: "Connect Era" },
  { kind: "oura", name: "Oura", description: "Readiness, sleep score, activity score, and stress — Oura's numbers, not Apple Health.", href: "/admin/connections/oura/connect", cta: "Connect Oura" },
]

const OAUTH_STATUS: Record<string, string> = {
  connected: "Connected successfully.",
  denied: "Access was declined.",
  not_configured: "OAuth is not configured yet.",
  authorize_failed: "Authorization could not start.",
  callback_failed: "Authorization did not complete.",
  invalid: "OAuth returned an incomplete callback.",
  unavailable: "The connections service was unavailable.",
}

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
  const [oauthStatus, setOauthStatus] = useState<string | null>(null)

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
    const params = new URLSearchParams(window.location.search)
    const oura = params.get("oura")
    const gmail = params.get("gmail")
    const calendar = params.get("calendar")
    if (oura && OURA_STATUS[oura]) setOauthStatus(`Oura: ${OURA_STATUS[oura]}`)
    else if (gmail && OAUTH_STATUS[gmail]) setOauthStatus(`Gmail: ${OAUTH_STATUS[gmail]}`)
    else if (calendar && OAUTH_STATUS[calendar]) setOauthStatus(`Calendar: ${OAUTH_STATUS[calendar]}`)
  }, [])

  return <section className="connections-grid" aria-live="polite">
    {oauthStatus && <div className="stream-message connections-wide" role="status"><span>{oauthStatus}</span></div>}
    {error && <div className="stream-message stream-message-error connections-wide" role="alert"><strong>Connection status is unavailable.</strong><span>{error}</span><button className="still-button still-button-secondary" onClick={load}>Try again</button></div>}
    {INTEGRATIONS.map(integration => <ConnectionCard integration={integration} rows={connections.filter(row => row.kind === integration.kind)} loading={loading} reload={load} key={integration.kind} />)}
  </section>
}

function ConnectionCard({ integration, rows, loading, reload }: { integration: typeof INTEGRATIONS[number]; rows: Connection[]; loading: boolean; reload: () => Promise<void> }) {
  const healthy = rows.filter(row => row.status === "active" && !row.lastError).length
  const needsAttention = rows.some(row => row.status !== "active" || row.lastError)
  const [showEraForm, setShowEraForm] = useState(false)
  const [showGranolaForm, setShowGranolaForm] = useState(false)
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

  const syncGranola = async () => {
    setBusyId("granola-sync"); setActionError(null)
    try {
      const response = await fetch("/api/connections/granola/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || "Granola could not be synced.")
      await reload()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Granola could not be synced.")
    } finally { setBusyId(null) }
  }

  const inlineConnect = integration.kind === "era" || integration.kind === "meetings"

  return <article className={needsAttention ? "connection-card connection-card-attention" : "connection-card"}>
    <div className="connection-card-heading"><div><span className={`connection-kind connection-kind-${integration.kind}`} aria-hidden>{KIND_MARK[integration.kind]}</span><div><h2>{integration.name}</h2><p>{integration.description}</p></div></div><span className={needsAttention ? "integration-status integration-status-error" : healthy ? "integration-status integration-status-active" : "integration-status"}>{loading ? "Checking…" : needsAttention ? "Needs attention" : healthy ? `${healthy} active` : "Not connected"}</span></div>
    <div className="connection-accounts">{loading ? <div className="connection-account-placeholder">Loading account status…</div> : rows.length === 0 ? <div className="connection-account-placeholder">No {integration.name} account connected yet.</div> : rows.map(row => <div className="connection-account" key={row.id}><div><strong>{row.label || row.accountEmail || "Unnamed account"}</strong><span>{row.accountEmail && row.label ? row.accountEmail : row.provider}</span></div><div><span>{row.lastError || (row.lastSyncedAt ? `Last synced ${formatRelative(row.lastSyncedAt)}` : "Not synced yet")}</span><small>{row.status}</small>{integration.kind === "oura" && row.status === "active" && row.actions.includes("sync") && <button className="connection-text-action" disabled={busyId !== null} onClick={() => void syncOura()}>{busyId === "oura-sync" ? "Syncing…" : "Sync now"}</button>}{integration.kind === "meetings" && row.status === "active" && <button className="connection-text-action" disabled={busyId !== null} onClick={() => void syncGranola()}>{busyId === "granola-sync" ? "Syncing…" : "Sync now"}</button>}{row.status === "active" && row.actions.includes("disconnect") && <button className="connection-text-action" disabled={busyId === row.id} onClick={() => void disconnect(row.id)}>{busyId === row.id ? "Disconnecting…" : "Disconnect"}</button>}</div></div>)}</div>
    {actionError && <p className="connection-action-error" role="alert">{actionError}</p>}
    {showEraForm && <ApiKeyConnectionForm idPrefix="era" label="Era API key" endpoint="/api/connections/era" errorLabel="Era" onConnected={async () => { setShowEraForm(false); await reload() }} onCancel={() => setShowEraForm(false)} />}
    {showGranolaForm && <ApiKeyConnectionForm idPrefix="granola" label="Granola API key" endpoint="/api/connections/granola" errorLabel="Granola" onConnected={async () => { setShowGranolaForm(false); await reload() }} onCancel={() => setShowGranolaForm(false)} />}
    <div className="connection-card-actions">{inlineConnect
      ? <button className="still-button still-button-primary" onClick={() => integration.kind === "era" ? setShowEraForm(value => !value) : setShowGranolaForm(value => !value)}>{rows.length ? `Reconnect ${integration.name}` : integration.cta}</button>
      : <a className="still-button still-button-primary" href={integration.href}>{rows.length ? integration.cta.replace("Connect", "Reconnect") : integration.cta}</a>}{integration.kind === "calendar" && rows.length > 0 && <a className="still-button still-button-secondary" href={`${EVENTS_URL}/settings/calendar`}>Manage calendars</a>}{rows.length > 0 && <span>{rows.reduce((sum, row) => sum + row.actions.length, 0)} available actions</span>}</div>
  </article>
}

function ApiKeyConnectionForm({ idPrefix, label, endpoint, errorLabel, onConnected, onCancel }: {
  idPrefix: string
  label: string
  endpoint: string
  errorLabel: string
  onConnected: () => Promise<void>
  onCancel: () => void
}) {
  const [apiKey, setApiKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || `${errorLabel} could not be connected.`)
      setApiKey("")
      await onConnected()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${errorLabel} could not be connected.`)
    } finally { setBusy(false) }
  }

  return <form className="connection-era-form" onSubmit={submit}>
    <label htmlFor={`${idPrefix}-api-key`}>{label}</label>
    <input id={`${idPrefix}-api-key`} type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} required />
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
