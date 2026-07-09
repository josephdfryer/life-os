"use client"

import { useState } from "react"

export default function TimezonePicker({ current }: { current: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(current)

  function save() {
    const tz = value.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone
    document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`
    setEditing(false)
    window.location.reload()
  }

  function detectAuto() {
    setValue(Intl.DateTimeFormat().resolvedOptions().timeZone)
  }

  const label: React.CSSProperties = {
    fontSize: "11px",
    color: "var(--ink-4)",
    fontFamily: "var(--font-body)",
  }
  const btn: React.CSSProperties = {
    fontSize: "11px",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
      {editing ? (
        <>
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="e.g. America/New_York"
            style={{
              ...label,
              padding: "2px 6px",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              background: "var(--surface)",
              color: "var(--ink)",
              width: "200px",
            }}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false) }}
            autoFocus
          />
          <button onClick={detectAuto} style={{ ...btn, color: "var(--ink-3)" }} title="Auto-detect">
            auto
          </button>
          <button onClick={save} style={{ ...btn, color: "var(--accent)" }}>save</button>
          <button onClick={() => setEditing(false)} style={{ ...btn, color: "var(--ink-4)" }}>cancel</button>
        </>
      ) : (
        <>
          <span style={label}>{current}</span>
          <button onClick={() => setEditing(true)} style={{ ...btn, color: "var(--ink-4)", textDecoration: "underline" }}>
            change
          </button>
        </>
      )}
    </div>
  )
}
