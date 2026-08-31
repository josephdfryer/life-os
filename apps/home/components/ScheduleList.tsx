"use client"

import AttendanceControls from "./AttendanceControls"
import { formatScheduleTime } from "@/lib/daily"

export type ScheduleRow = {
  id: string
  name: string
  start: string
  href: string | null
  scheduled: boolean
  place: { name: string } | null
  attendees: { id: string; name: string }[]
  calendars: string[]
  planId: string | null
  declaredAttendance: "going" | "not_going"
  reconciliationStatus: string | null
  tension: "aligned" | "missed" | "showed_up" | "pending"
  phase: "future" | "past"
}

export default function ScheduleList({
  events,
  personsUrl,
  tz,
}: {
  events: ScheduleRow[]
  personsUrl: string
  tz: string
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {events.map((event) => {
        const uniqueAttendees = event.attendees.slice(0, 3)
        const quiet = event.declaredAttendance === "not_going" && event.phase === "future"
        const title = event.href ? (
          <a href={event.href} style={{ fontWeight: 500, lineHeight: 1.3, color: "inherit", textDecoration: "none", opacity: quiet ? 0.72 : 1 }}>
            {event.name}
          </a>
        ) : (
          <span style={{ fontWeight: 500, lineHeight: 1.3, opacity: quiet ? 0.72 : 1 }}>{event.name}</span>
        )

        return (
          <div key={event.id} style={{ display: "flex", gap: "24px" }}>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                color: "var(--ink-3)",
                paddingTop: "2px",
                minWidth: "72px",
                flexShrink: 0,
              }}
            >
              {formatScheduleTime(new Date(event.start), tz)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {title}
                {event.scheduled && <span style={scheduledBadge}>Scheduled</span>}
              </div>
              {event.calendars.length > 0 && (
                <div style={{ fontSize: "12px", color: "var(--ink-3)", marginTop: "4px" }}>
                  {event.calendars.join(" · ")}
                </div>
              )}
              {uniqueAttendees.length > 0 && (
                <div style={{ fontSize: "12px", color: "var(--ink-3)", marginTop: "4px" }}>
                  with {uniqueAttendees.map((person, i) => (
                    <span key={person.id}>
                      {i > 0 && ", "}
                      <a href={`${personsUrl}/persons/${person.id}`} style={{ color: "var(--camel)", textDecoration: "none" }}>
                        {person.name}
                      </a>
                    </span>
                  ))}
                </div>
              )}
              {event.place && (
                <div style={{ fontSize: "12px", color: "var(--ink-3)", marginTop: "2px" }}>
                  {event.place.name}
                </div>
              )}
            </div>
            <AttendanceControls
              planId={event.planId}
              phase={event.phase}
              declared={event.declaredAttendance}
              reconciliationStatus={event.reconciliationStatus}
              tension={event.tension}
              endpointFor={(planId) => `/api/calendar/plans/${planId}/attendance`}
            />
          </div>
        )
      })}
    </div>
  )
}

const scheduledBadge: React.CSSProperties = {
  fontSize: "10px",
  padding: "2px 8px",
  color: "var(--camel)",
  border: "1px solid rgba(196, 165, 116, 0.24)",
  borderRadius: "var(--radius-pill)",
}
