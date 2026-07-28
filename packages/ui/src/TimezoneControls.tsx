"use client"

import React, { useEffect, useState } from "react"
import {
  COMMON_TIME_ZONES,
  detectBrowserTimeZone,
  isValidTimeZone,
  readTzCookie,
  writeTzCookie,
} from "./timezone"

// Silently sets the shared master `tz` cookie from the browser on first visit if
// it isn't set yet. Mount once in every app's root layout. Never overrides an
// existing value — the master (set at Home) always wins.
export function TimezoneDetector() {
  useEffect(() => {
    if (!readTzCookie()) writeTzCookie(detectBrowserTimeZone())
  }, [])
  return null
}

export interface TimezonePickerProps {
  /** The timezone the server resolved for this render. */
  current: string
  /** Compact inline styling for a settings row (default) vs. a standalone block. */
  label?: string
}

// The master timezone control — lives at Home. Writes the shared root-domain
// cookie so every *.lacollecteur.com app inherits the change, then reloads.
export function TimezonePicker({ current, label = "Timezone" }: TimezonePickerProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(current)
  const [detected, setDetected] = useState<string | null>(null)

  useEffect(() => {
    setDetected(detectBrowserTimeZone())
  }, [])

  function save(next: string) {
    const tz = next.trim()
    if (!isValidTimeZone(tz)) return
    writeTzCookie(tz)
    setEditing(false)
    window.location.reload()
  }

  const chip: React.CSSProperties = {
    fontSize: 12,
    color: "var(--ink-3)",
    fontFamily: "var(--font-body, system-ui)",
  }
  const btn: React.CSSProperties = {
    ...chip,
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    color: "var(--cognac, var(--accent))",
  }

  if (!editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={chip}>
          {label}: <strong style={{ color: "var(--ink-2, var(--ink))", fontWeight: 500 }}>{current}</strong>
        </span>
        <button style={btn} onClick={() => { setValue(current); setEditing(true) }}>Change</button>
        {detected && detected !== current && (
          <button style={btn} onClick={() => save(detected)} title={`Use this device's timezone (${detected})`}>
            Use {detected}
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <input
        list="lifeos-tz-list"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="e.g. America/New_York"
        autoFocus
        onKeyDown={e => { if (e.key === "Enter") save(value); if (e.key === "Escape") setEditing(false) }}
        style={{
          ...chip,
          padding: "4px 8px",
          border: "1px solid var(--border, #ccc)",
          borderRadius: 6,
          background: "var(--surface, #fff)",
          color: "var(--ink, #111)",
          width: 220,
        }}
      />
      <datalist id="lifeos-tz-list">
        {COMMON_TIME_ZONES.map(tz => <option key={tz} value={tz} />)}
      </datalist>
      <button style={btn} onClick={() => save(value)}>Save</button>
      <button style={{ ...btn, color: "var(--ink-4)" }} onClick={() => setEditing(false)}>Cancel</button>
    </div>
  )
}
