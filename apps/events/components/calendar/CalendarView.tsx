"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  calendarRange,
  monthGridDays,
  parseCalendarDate,
  parseCalendarMode,
  shiftCalendarAnchor,
  toDateKey,
  weekGridDays,
  type CalendarMode,
} from "@/lib/calendar"
import { formatEventTime, formatEventType } from "@/lib/events"

type CalendarEvent = {
  id: string
  name: string
  type: string
  start: string
  end: string | null
  place?: { name: string } | null
  href?: string | null
}

type Props = {
  initialMode: CalendarMode
  initialDate: string
}

export default function CalendarView({ initialMode, initialDate }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const mode = parseCalendarMode(initialMode)
  const anchor = useMemo(() => parseCalendarDate(initialDate), [initialDate])
  const range = useMemo(() => calendarRange(mode, anchor), [mode, anchor])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setError(null)
      const params = new URLSearchParams({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      })
      const res = await fetch(`/api/events/range?${params.toString()}`)
      if (!res.ok) {
        if (!cancelled) setError("Could not load events")
        return
      }
      const data = await res.json()
      if (!cancelled) setEvents(data.data ?? [])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [range.start.toISOString(), range.end.toISOString()])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const key = toDateKey(new Date(event.start))
      const bucket = map.get(key) ?? []
      bucket.push(event)
      map.set(key, bucket)
    }
    return map
  }, [events])

  function navigate(nextMode: CalendarMode, nextDate: Date) {
    const params = new URLSearchParams()
    params.set("mode", nextMode)
    params.set("date", toDateKey(nextDate))
    startTransition(() => router.push(`/events/calendar?${params.toString()}`))
  }

  function shift(direction: -1 | 1) {
    navigate(mode, shiftCalendarAnchor(mode, anchor, direction))
  }

  const days = mode === "month" ? monthGridDays(anchor) : weekGridDays(anchor)

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: "24px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button type="button" onClick={() => shift(-1)} style={navButtonStyle} aria-label="Previous">
            ←
          </button>
          <button type="button" onClick={() => shift(1)} style={navButtonStyle} aria-label="Next">
            →
          </button>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "22px",
              fontWeight: 600,
              margin: 0,
              minWidth: "180px",
            }}
          >
            {range.label}
          </h2>
          {isPending && <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>Loading…</span>}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <ModeButton active={mode === "week"} label="Week" onClick={() => navigate("week", anchor)} />
          <ModeButton active={mode === "month"} label="Month" onClick={() => navigate("month", anchor)} />
          <button type="button" onClick={() => navigate(mode, new Date())} style={todayButtonStyle}>
            Today
          </button>
        </div>
      </div>

      {error && <div style={{ color: "#f87171", fontSize: "12px", marginBottom: "16px" }}>{error}</div>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: mode === "week" ? "repeat(7, minmax(0, 1fr))" : "repeat(7, minmax(0, 1fr))",
          gap: "8px",
        }}
      >
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
          <div
            key={label}
            style={{
              fontSize: "10px",
              color: "var(--ink-4)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              padding: "0 4px 8px",
            }}
          >
            {label}
          </div>
        ))}

        {days.map((day) => {
          const key = toDateKey(day)
          const dayEvents = eventsByDay.get(key) ?? []
          const inMonth = mode === "week" || day.getMonth() === anchor.getMonth()
          const isToday = key === toDateKey(new Date())

          return (
            <div
              key={key}
              style={{
                minHeight: mode === "month" ? "120px" : "180px",
                background: "var(--surface)",
                border: `1px solid ${isToday ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "12px",
                padding: "8px",
                opacity: inMonth ? 1 : 0.45,
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  color: isToday ? "var(--accent)" : "var(--ink-3)",
                  marginBottom: "8px",
                  fontWeight: isToday ? 600 : 400,
                }}
              >
                {day.getDate()}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {dayEvents.slice(0, mode === "month" ? 3 : 8).map((event) => {
                  const { range: timeRange } = formatEventTime(new Date(event.start), event.end ? new Date(event.end) : null)
                  return (
                    <a
                      key={event.id}
                      href={event.href ?? "#"}
                      aria-disabled={!event.href}
                      onClick={event.href ? undefined : event => event.preventDefault()}
                      style={{
                        display: "block",
                        textDecoration: "none",
                        color: "inherit",
                        background: "var(--surface2)",
                        borderRadius: "8px",
                        padding: "6px 8px",
                        border: "1px solid transparent",
                      }}
                    >
                      <div style={{ fontSize: "10px", color: "var(--accent)", marginBottom: "2px" }}>{timeRange}</div>
                      <div
                        style={{
                          fontSize: "11px",
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {event.name}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "2px" }}>
                        {formatEventType(event.type)}
                      </div>
                    </a>
                  )
                })}
                {dayEvents.length > (mode === "month" ? 3 : 8) && (
                  <div style={{ fontSize: "10px", color: "var(--ink-4)", paddingLeft: "4px" }}>
                    +{dayEvents.length - (mode === "month" ? 3 : 8)} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ModeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 14px",
        borderRadius: "999px",
        fontSize: "11px",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--ink-3)",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  )
}

const navButtonStyle: React.CSSProperties = {
  width: "32px",
  height: "32px",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--ink)",
  cursor: "pointer",
  fontFamily: "inherit",
}

const todayButtonStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "999px",
  fontSize: "11px",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--ink-3)",
  cursor: "pointer",
  fontFamily: "inherit",
}
