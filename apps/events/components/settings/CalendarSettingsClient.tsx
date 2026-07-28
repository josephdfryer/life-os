"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTimeZone } from "@life-os/ui"

type CalendarStatus = {
  configured: boolean
  redirectUri: string
  expectedAccountEmail: string | null
  discoveryError: string | null
  connection: {
    id: string
    status: string
    accountEmail: string | null
    calendarId: string
    calendarSummary: string | null
    lastSyncedAt: string | null
    lastError: string | null
    eventCount: number
  } | null
  connections: {
    id: string
    status: string
    accountEmail: string | null
    calendarId: string
    calendarSummary: string | null
    lastSyncedAt: string | null
    lastError: string | null
    eventCount: number
  }[]
  availableCalendars: {
    id: string
    googleCalendarId: string
    summary: string
    description: string | null
    primary: boolean
    accessRole: string | null
    backgroundColor: string | null
    foregroundColor: string | null
    hidden: boolean
    selected: boolean
  }[]
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
  const tz = useTimeZone()
  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [trace, setTrace] = useState<CalendarTrace | null>(null)
  const [backfillDays, setBackfillDays] = useState("180")
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [resetResult, setResetResult] = useState<string | null>(null)
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingSelection, setSavingSelection] = useState(false)
  const [resetting, setResetting] = useState(false)
  const expectedAccountEmail = status?.expectedAccountEmail ?? "jdf247@gmail.com"
  const activeConnections = status?.connections.filter(connection => connection.status === "active") ?? []
  const savedCalendarIds = status?.availableCalendars.filter(calendar => calendar.selected).map(calendar => calendar.id) ?? []
  const selectionChanged = !sameSelection(selectedCalendarIds, savedCalendarIds)

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
    setSelectedCalendarIds(data.availableCalendars
      .filter((calendar: CalendarStatus["availableCalendars"][number]) => calendar.selected)
      .map((calendar: CalendarStatus["availableCalendars"][number]) => calendar.id))
  }

  function toggleCalendar(calendarId: string) {
    setSelectedCalendarIds(current => current.includes(calendarId)
      ? current.filter(id => id !== calendarId)
      : [...current, calendarId])
  }

  async function saveCalendarSelection() {
    setSavingSelection(true)
    setError(null)
    try {
      const res = await fetch("/api/calendar/google/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarIds: selectedCalendarIds }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? data.error ?? "Could not save calendar selection")
      setStatus(data)
      setSelectedCalendarIds(data.availableCalendars.filter((calendar: CalendarStatus["availableCalendars"][number]) => calendar.selected).map((calendar: CalendarStatus["availableCalendars"][number]) => calendar.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save calendar selection")
    } finally {
      setSavingSelection(false)
    }
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
    const confirmed = window.confirm("Remove imported events from every selected Google calendar and disconnect this Google account?")
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
            <div style={{ fontSize: "14px", fontWeight: 600 }}>{status.connection.accountEmail ?? "Google account"}</div>
            <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>
              Connected · {activeConnections.length} {activeConnections.length === 1 ? "calendar" : "calendars"} selected
            </div>
          </div>
        ) : status?.configured ? (
          <p style={copyStyle}>Connect Google Calendar to import events and match attendees to People by email.</p>
        ) : null}
      </section>

      {status?.connection && (
        <section style={panelStyle}>
          <div style={panelTitleStyle}>Calendars to import</div>
          <p style={copyStyle}>
            Choose any calendar visible to {status.connection.accountEmail ?? expectedAccountEmail}. Life OS keeps each source separate and imports events read-only.
          </p>

          {status.discoveryError && (
            <div style={warningStyle}>{status.discoveryError}. Reconnect Google Calendar, then try again.</div>
          )}

          <div style={calendarListStyle}>
            {status.availableCalendars.map(calendar => {
              const checked = selectedCalendarIds.includes(calendar.id)
              return (
                <label key={calendar.id} style={{ ...calendarOptionStyle, ...(checked ? selectedCalendarOptionStyle : {}) }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCalendar(calendar.id)}
                    style={checkboxStyle}
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      ...calendarDotStyle,
                      background: calendar.backgroundColor ?? "var(--cognac)",
                    }}
                  />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={calendarNameStyle}>
                      {calendar.summary}{calendar.primary ? " (primary)" : ""}
                    </span>
                    <span style={calendarMetaStyle}>
                      {calendar.googleCalendarId} · {calendar.accessRole ?? "readable"}
                    </span>
                  </span>
                </label>
              )
            })}
            {!status.discoveryError && status.availableCalendars.length === 0 && (
              <div style={emptyStyle}>No readable calendars were returned by Google.</div>
            )}
          </div>

          <div style={selectionFooterStyle}>
            <span style={{ fontSize: "12px", color: "var(--ink-3)" }}>
              {selectedCalendarIds.length} selected
            </span>
            <button
              type="button"
              onClick={saveCalendarSelection}
              disabled={savingSelection || !selectionChanged}
              style={{ ...secondaryButtonStyle, ...((savingSelection || !selectionChanged) ? disabledButtonStyle : {}) }}
            >
              {savingSelection ? "Saving…" : selectionChanged ? "Save calendars" : "Saved"}
            </button>
          </div>
        </section>
      )}

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
        <button
          type="button"
          onClick={syncNow}
          disabled={saving || activeConnections.length === 0 || selectionChanged}
          style={{ ...primaryButtonStyle, ...((saving || activeConnections.length === 0 || selectionChanged) ? disabledButtonStyle : {}) }}
        >
          {saving ? "Syncing…" : selectionChanged ? "Save calendars before syncing" : `Sync ${activeConnections.length || "selected"} ${activeConnections.length === 1 ? "calendar" : "calendars"}`}
        </button>
        {syncResult && <pre style={preStyle}>{syncResult}</pre>}
        <button type="button" onClick={resetImport} disabled={resetting || !status?.connection} style={dangerButtonStyle}>
          {resetting ? "Removing…" : "Remove imported calendar data"}
        </button>
        {resetResult && <pre style={preStyle}>{resetResult}</pre>}
      </section>

      {activeConnections.length > 0 && (
        <section style={panelStyle}>
          <div style={panelTitleStyle}>Import status</div>
          <div style={{ display: "grid", gap: "8px" }}>
            {activeConnections.map(connection => (
              <div key={connection.id} style={statusRowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={calendarNameStyle}>{connection.calendarSummary ?? connection.calendarId}</div>
                  <div style={calendarMetaStyle}>
                    {connection.eventCount} linked events · last sync {formatDate(connection.lastSyncedAt, tz)}
                  </div>
                  {connection.lastError && <div style={connectionErrorStyle}>{connection.lastError}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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

function formatDate(value: string | null, timeZone?: string) {
  if (!value) return "never"
  return new Date(value).toLocaleString("en-US", { timeZone })
}

function sameSelection(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every(value => rightSet.has(value))
}

const panelStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "20px",
  boxShadow: "var(--shadow-sm)",
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
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "8px 12px",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontSize: "12px",
  marginBottom: "12px",
}

const primaryLinkStyle: React.CSSProperties = {
  display: "inline-block",
  background: "var(--cognac)",
  color: "var(--surface)",
  borderRadius: "var(--radius-pill)",
  padding: "10px 16px",
  fontSize: "12px",
  fontWeight: 600,
  textDecoration: "none",
}

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--cognac)",
  color: "var(--surface)",
  border: "none",
  borderRadius: "var(--radius-pill)",
  padding: "10px 16px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
}

const dangerButtonStyle: React.CSSProperties = {
  width: "100%",
  background: "transparent",
  color: "var(--attention)",
  border: "1px solid var(--attention)",
  borderRadius: "var(--radius-pill)",
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
  borderRadius: "var(--radius-pill)",
  padding: "6px 10px",
  fontSize: "11px",
  cursor: "pointer",
  fontFamily: "inherit",
}

const preStyle: React.CSSProperties = {
  marginTop: "12px",
  background: "var(--surface-2)",
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
  background: "var(--surface-2)",
}

const calendarListStyle: React.CSSProperties = {
  display: "grid",
  gap: "8px",
  marginTop: "16px",
  maxHeight: "360px",
  overflowY: "auto",
}

const calendarOptionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "12px",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius)",
  background: "var(--surface)",
  cursor: "pointer",
}

const selectedCalendarOptionStyle: React.CSSProperties = {
  borderColor: "var(--cognac)",
  background: "var(--cognac-soft)",
}

const checkboxStyle: React.CSSProperties = {
  width: "16px",
  height: "16px",
  accentColor: "var(--cognac)",
  flex: "0 0 auto",
}

const calendarDotStyle: React.CSSProperties = {
  width: "10px",
  height: "10px",
  borderRadius: "50%",
  flex: "0 0 auto",
}

const calendarNameStyle: React.CSSProperties = {
  display: "block",
  color: "var(--ink)",
  fontSize: "13px",
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
}

const calendarMetaStyle: React.CSSProperties = {
  display: "block",
  color: "var(--ink-3)",
  fontSize: "11px",
  marginTop: "3px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
}

const selectionFooterStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  marginTop: "16px",
}

const secondaryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--cognac-deep)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-pill)",
  padding: "8px 14px",
  fontFamily: "inherit",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
}

const disabledButtonStyle: React.CSSProperties = {
  cursor: "not-allowed",
  opacity: 0.55,
}

const statusRowStyle: React.CSSProperties = {
  padding: "12px",
  borderRadius: "var(--radius)",
  background: "var(--surface-2)",
  border: "1px solid var(--border-subtle)",
}

const warningStyle: React.CSSProperties = {
  marginTop: "12px",
  padding: "10px 12px",
  borderRadius: "var(--radius)",
  background: "var(--attention-soft)",
  color: "var(--attention)",
  fontSize: "12px",
}

const connectionErrorStyle: React.CSSProperties = {
  marginTop: "6px",
  color: "var(--attention)",
  fontSize: "11px",
}

const emptyStyle: React.CSSProperties = {
  padding: "16px",
  borderRadius: "var(--radius)",
  background: "var(--surface-2)",
  color: "var(--ink-3)",
  fontSize: "12px",
  textAlign: "center",
}
