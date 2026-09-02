"use client"

import AttendanceControls from "./AttendanceControls"
import { formatEventTime, formatEventType } from "@/lib/events"

export type TimelineRow = {
  id: string
  name: string
  start: string
  end: string | null
  href: string | null
  type: string
  place: { name: string } | null
  attendees: { id: string; name: string }[]
  calendars: string[]
  interactionCount: number
  planId: string | null
  eventId: string | null
  declaredAttendance: "going" | "not_going"
  reconciliationStatus: string | null
  tension: "aligned" | "missed" | "showed_up" | "pending"
  phase: "future" | "past"
}

export default function TimelineList({ items, timeZone }: { items: TimelineRow[]; timeZone: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {items.map((item) => {
        const { date, range } = formatEventTime(
          new Date(item.start),
          item.end ? new Date(item.end) : null,
          timeZone,
        )
        const quiet = item.declaredAttendance === "not_going" && item.phase === "future"
        const title = item.href ? (
          <a
            href={item.href}
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "17px",
              fontWeight: 400,
              marginBottom: "4px",
              color: "inherit",
              textDecoration: "none",
              display: "block",
              opacity: quiet ? 0.72 : 1,
            }}
          >
            {item.name}
          </a>
        ) : (
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "17px",
              fontWeight: 400,
              marginBottom: "4px",
              opacity: quiet ? 0.72 : 1,
            }}
          >
            {item.name}
          </div>
        )

        return (
          <div key={item.id} className="event-row" style={rowStyle}>
            <div>
              <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "4px" }}>{date}</div>
              <div style={{ fontSize: "12px", color: "var(--cognac)" }}>{range}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              {title}
              {item.calendars.length > 0 && (
                <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "4px" }}>
                  {item.calendars.length === 1
                    ? `Calendar: ${item.calendars[0]}`
                    : `Calendars: ${item.calendars.join(" + ")}`}
                </div>
              )}
              {item.attendees.length > 0 && (
                <div style={{ fontSize: "11px", color: "var(--ink-3)", marginBottom: "4px" }}>
                  with {item.attendees.map((person) => person.name).join(", ")}
                </div>
              )}
              {item.place && (
                <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>📍 {item.place.name}</div>
              )}
            </div>
            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--ink-4)",
                  background: "var(--cognac-soft)",
                  padding: "3px 8px",
                  borderRadius: "var(--radius-pill)",
                  whiteSpace: "nowrap",
                }}
              >
                {formatEventType(item.type)}
              </span>
              <AttendanceControls
                planId={item.planId}
                eventId={item.eventId}
                phase={item.phase}
                declared={item.declaredAttendance}
                reconciliationStatus={item.reconciliationStatus}
                tension={item.tension}
                endpointFor={(planId) => `/api/calendar/plans/${planId}/attendance`}
                notEventEndpointFor={(eventId) => `/api/events/${eventId}/not-event`}
              />
              {item.interactionCount > 0 && (
                <div style={{ fontSize: "10px", color: "var(--ink-4)" }}>
                  {item.interactionCount} interaction{item.interactionCount !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "120px 1fr auto",
  gap: "16px",
  alignItems: "start",
  background: "var(--surface)",
  border: "1px solid transparent",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow-sm)",
  padding: "16px 18px",
  color: "inherit",
  transition: "border-color 0.1s, box-shadow 0.1s",
}
