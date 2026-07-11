"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"

type CalendarStatus = {
  configured: boolean
  redirectUri: string
  expectedAccountEmail: string
  connection: {
    id: string
    status: string
    accountEmail: string | null
    calendarId: string
    calendarSummary: string | null
    syncToken: string | null
    lastSyncedAt: string | null
    lastError: string | null
    eventCount: number
  } | null
}

type CalendarTrace = {
  runs: { id: string; createdAt: string; metadata: unknown }[]
  events: {
    id: string
    externalEventId: string
    event: { id: string; name: string; start: string } | null
    linkedPeople: { personId: string; name: string }[]
  }[]
}

const BACKFILL_OPTIONS = [
  { value: "30", label: "Past 30 days" },
  { value: "90", label: "Past 90 days" },
  { value: "180", label: "Past 6 months" },
  { value: "365", label: "Past year" },
]

export default function CalendarSettingsClient() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [trace, setTrace] = useState<CalendarTrace | null>(null)
  const [backfillDays, setBackfillDays] = useState("180")
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [resetResult, setResetResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const expectedAccountEmail = status?.expectedAccountEmail ?? "jdf247@gmail.com"

  useEffect(() => {
    void loadStatus()
    void loadTrace()
  }, [])

  useEffect(() => {
    if (searchParams.get("calendar") === "connected") {
      void loadStatus()
      void loadTrace()
    }
  }, [searchParams])

  async function loadStatus() {
    const res = await fetch("/api/calendar/google/status")
    const data = await res.json()
    if (!res.ok) {
      setError(data.error?.message ?? data.error ?? "Could not load calendar status")
      return
    }
    setStatus(data)
  }

  async function loadTrace() {
    const res = await fetch("/api/calendar/google/trace?limit=50")
    const data = await res.json()
    if (!res.ok) {
      setError(data.error?.message ?? data.error ?? "Could not load calendar trace")
      return
    }
    setTrace(data)
  }

  async function syncNow() {
    setSaving(true)
    setError(null)
    setSyncResult(null)
    try {
      const res = await fetch("/api/calendar/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backfillDays: Number(backfillDays) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? data.error ?? "Sync failed")
      setSyncResult(JSON.stringify(data, null, 2))
      await Promise.all([loadStatus(), loadTrace()])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed")
    } finally {
      setSaving(false)
    }
  }

  async function resetImport() {
    const confirmed = window.confirm("Remove imported Google Calendar events and disconnect the current Calendar account?")
    if (!confirmed) return

    setResetting(true)
    setError(null)
    setResetResult(null)
    try {
      const res = await fetch("/api/calendar/google/reset", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? data.error ?? "Reset failed")
      setResetResult(JSON.stringify(data, null, 2))
      await Promise.all([loadStatus(), loadTrace()])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed")
    } finally {
      setResetting(false)
    }
  }

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      {error && (
        <div style={{ border: "1px solid #b45309", background: "rgba(245,158,11,0.08)", color: "#fbbf24", borderRadius: "10px", padding: "12px", fontSize: "12px" }}>
          {error}
        </div>
      )}

      <section style={panelStyle}>
        <div style={panelTitleStyle}>Google Calendar</div>
        {!status?.configured && (
          <p style={copyStyle}>
            Add `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` (or reuse the Google OAuth client with Calendar API enabled).
          </p>
        )}
        {status?.redirectUri && (
          <div style={codeBoxStyle}>
            <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "4px" }}>Redirect URI</div>
            {status.redirectUri}
          </div>
        )}
        {status?.expectedAccountEmail && (
          <div style={codeBoxStyle}>
            <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "4px" }}>Expected account</div>
            {status.expectedAccountEmail}
          </div>
        )}
        {status?.connection ? (
          <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
            <div style={{ fontSize: "14px", fontWeight: 600 }}>{status.connection.calendarSummary ?? "Primary calendar"}</div>
            <div style={{ fontSize: "12px", color: "var(--ink-3)" }}>{status.connection.accountEmail ?? "Google account"}</div>
            <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>
              {status.connection.eventCount} linked events · last sync {formatDate(status.connection.lastSyncedAt)}
            </div>
            {status.connection.lastError && (
              <div style={{ fontSize: "11px", color: "#f87171" }}>{status.connection.lastError}</div>
            )}
          </div>
        ) : status?.configured ? (
          <p style={copyStyle}>Connect Google Calendar to import events and match attendees to People by email.</p>
        ) : null}
      </section>

      <section style={panelStyle}>
        <div style={panelTitleStyle}>Actions</div>
        <a href="/api/calendar/google/connect?returnTo=/settings/calendar" style={primaryLinkStyle}>
          {status?.connection ? `Reconnect ${expectedAccountEmail}` : `Connect ${expectedAccountEmail}`}
        </a>
        <label style={{ ...labelStyle, marginTop: "14px" }}>Backfill range</label>
        <select value={backfillDays} onChange={(e) => setBackfillDays(e.target.value)} style={inputStyle}>
          {BACKFILL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={syncNow} disabled={saving || !status?.connection} style={primaryButtonStyle}>
          {saving ? "Syncing…" : "Sync now"}
        </button>
        {syncResult && <pre style={preStyle}>{syncResult}</pre>}
        <button type="button" onClick={resetImport} disabled={resetting || !status?.connection} style={dangerButtonStyle}>
          {resetting ? "Removing…" : "Remove imported calendar data"}
        </button>
        {resetResult && <pre style={preStyle}>{resetResult}</pre>}
      </section>

      <section style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
          <div style={panelTitleStyle}>Recent imports</div>
          <button type="button" onClick={loadTrace} style={smallButtonStyle}>
            Refresh
          </button>
        </div>
        <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
          {(trace?.events ?? []).slice(0, 20).map((item) => (
            <div key={item.id} style={traceRowStyle}>
              <div style={{ fontSize: "13px", fontWeight: 500 }}>{item.event?.name ?? "Missing local event"}</div>
              <div style={{ fontSize: "11px", color: "var(--ink-4)", marginTop: "4px" }}>
                {item.linkedPeople.length
                  ? `Matched: ${item.linkedPeople.map((p) => p.name).join(", ")}`
                  : "No people matched"}
              </div>
            </div>
          ))}
          {trace && trace.events.length === 0 && <div style={copyStyle}>No imported calendar events yet.</div>}
        </div>
      </section>
    </div>
  )
}

function formatDate(value: string | null) {
  if (!value) return "never"
  return new Date(value).toLocaleString()
}

const panelStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "14px",
  padding: "20px",
}

const panelTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "18px",
  fontWeight: 600,
  marginBottom: "8px",
}

const copyStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--ink-3)",
  lineHeight: 1.5,
  margin: 0,
}

const codeBoxStyle: React.CSSProperties = {
  marginTop: "12px",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "10px",
  fontSize: "11px",
  color: "var(--ink-3)",
  wordBreak: "break-word",
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "11px",
  color: "var(--ink-3)",
  marginBottom: "4px",
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "8px 12px",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontSize: "12px",
  marginBottom: "12px",
}

const primaryLinkStyle: React.CSSProperties = {
  display: "inline-block",
  background: "var(--accent)",
  color: "#0d0d0d",
  borderRadius: "8px",
  padding: "10px 16px",
  fontSize: "12px",
  fontWeight: 600,
  textDecoration: "none",
}

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--accent)",
  color: "#0d0d0d",
  border: "none",
  borderRadius: "8px",
  padding: "10px 16px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
}

const dangerButtonStyle: React.CSSProperties = {
  width: "100%",
  background: "transparent",
  color: "#f87171",
  border: "1px solid rgba(248,113,113,0.35)",
  borderRadius: "8px",
  padding: "10px 16px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  marginTop: "12px",
}

const smallButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--ink-3)",
  borderRadius: "8px",
  padding: "6px 10px",
  fontSize: "11px",
  cursor: "pointer",
  fontFamily: "inherit",
}

const preStyle: React.CSSProperties = {
  marginTop: "12px",
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "10px",
  fontSize: "10px",
  overflowX: "auto",
  color: "var(--ink-2)",
}

const traceRowStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "10px",
  padding: "10px 12px",
  background: "var(--surface2)",
}
