"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

export type EventSignalRow = {
  id: string
  source: string
  title: string
  detail: string | null
  when: string | null
}

type Props = {
  initialItems: EventSignalRow[]
  endpointFor: (id: string) => string
  variant?: "light" | "dark"
  tz?: string
}

export default function EventSignalsList({
  initialItems,
  endpointFor,
  variant = "light",
  tz = "America/Los_Angeles",
}: Props) {
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dark = variant === "dark"

  async function act(id: string, action: "not_event" | "went" | "didnt_go") {
    if (busyId) return
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(endpointFor(id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error?.message ?? data.error ?? "Could not save feedback")
      setItems(current => current.filter(item => item.id !== id))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save feedback")
    } finally {
      setBusyId(null)
    }
  }

  if (!items.length) return null

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: dark ? "10px" : "12px" }}>
      {items.map(item => (
        <article
          key={item.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            padding: dark ? "12px 14px" : undefined,
            borderRadius: dark ? "var(--radius-md, 12px)" : undefined,
            border: dark ? "1px solid rgba(196, 165, 116, 0.18)" : undefined,
            background: dark ? "rgba(247, 244, 238, 0.03)" : undefined,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={sourceBadge(dark)}>{sourceLabel(item.source)}</span>
              {item.when ? (
                <span style={meta(dark)}>{formatWhen(item.when, tz)}</span>
              ) : null}
            </div>
            <div style={{
              fontWeight: 500,
              lineHeight: 1.35,
              color: dark ? "var(--ink-1, #f7f4ee)" : "inherit",
              marginTop: "4px",
            }}>
              {item.title}
            </div>
            {item.detail ? (
              <div style={{ ...meta(dark), marginTop: "4px" }}>{item.detail}</div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
            <button type="button" disabled={busyId === item.id} onClick={() => void act(item.id, "not_event")} style={pill(dark, false)}>
              Not event
            </button>
            <button type="button" disabled={busyId === item.id} onClick={() => void act(item.id, "went")} style={pill(dark, true)}>
              Went
            </button>
            <button type="button" disabled={busyId === item.id} onClick={() => void act(item.id, "didnt_go")} style={pill(dark, false)}>
              Didn't
            </button>
          </div>
        </article>
      ))}
      {error ? (
        <div style={{ fontSize: "11px", color: "var(--attention, #c45c26)" }} role="alert">{error}</div>
      ) : null}
    </div>
  )
}

function sourceLabel(source: string) {
  if (source === "calendar_reconciliation") return "Calendar"
  if (source === "note_suggestion") return "Note"
  if (source === "communication_occurrence") return "Message"
  if (source === "evidence_claim") return "File"
  return "Signal"
}

function formatWhen(value: string, tz: string) {
  return new Date(value).toLocaleString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function sourceBadge(dark: boolean): React.CSSProperties {
  return {
    fontSize: "10px",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: dark ? "var(--camel, #c4a574)" : "var(--cognac, #8f6b4a)",
  }
}

function meta(dark: boolean): React.CSSProperties {
  return {
    fontSize: "11px",
    color: dark ? "var(--ink-3, #a69c90)" : "var(--ink-3, #7a7268)",
  }
}

function pill(dark: boolean, accent: boolean): React.CSSProperties {
  return {
    fontFamily: "inherit",
    fontSize: "10px",
    padding: "4px 10px",
    borderRadius: "999px",
    cursor: "pointer",
    border: accent
      ? "1px solid var(--cognac, #8f6b4a)"
      : dark
        ? "1px solid rgba(196, 165, 116, 0.24)"
        : "1px solid var(--border, #d9d0c3)",
    background: accent
      ? dark ? "rgba(196, 165, 116, 0.18)" : "var(--cognac-soft, #efe4d4)"
      : "transparent",
    color: accent
      ? dark ? "var(--camel, #c4a574)" : "var(--cognac-deep, #6e5238)"
      : dark ? "var(--ink-3, #a69c90)" : "var(--ink-3, #7a7268)",
  }
}
