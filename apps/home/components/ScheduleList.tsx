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
  eventId: string | null
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
    <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
      {events.map((event) => {
        const uniqueAttendees = event.attendees.slice(0, 3)
        const quiet = event.declaredAttendance === "not_going" && event.phase === "future"
        const title = event.href ? (
          <a href={event.href} style={{ fontWeight: 500, lineHeight: 1.5, color: "inherit", textDecoration: "none", opacity: quiet ? 0.72 : 1 }}>
            {event.name}
          </a>
        ) : (
          <span style={{ fontWeight: 500, lineHeight: 1.5, opacity: quiet ? 0.72 : 1 }}>{event.name}</span>
        )

        return (
          <div key={event.id} style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                color: "var(--ink-3)",
                paddingTop: "4px",
                minWidth: "64px",
                flexShrink: 0,
              }}
            >
              {formatScheduleTime(new Date(event.start), tz)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
                {title}
                {event.scheduled && <span style={scheduledBadge}>Scheduled</span>}
              </div>
              {event.calendars.length > 0 && (
                <div style={{ fontSize: "12px", color: "var(--ink-3)", marginTop: "8px", lineHeight: 1.6 }}>
                  {event.calendars.join(" · ")}
                </div>
              )}
              {uniqueAttendees.length > 0 && (
                <div style={{ fontSize: "12px", color: "var(--ink-3)", marginTop: "8px", lineHeight: 1.6 }}>
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
                <div style={{ fontSize: "12px", color: "var(--ink-3)", marginTop: "8px", lineHeight: 1.6 }}>
                  {event.place.name}
                </div>
              )}
            </div>
            <div style={{ marginLeft: "auto", flexShrink: 0 }}>
              <AttendanceControls
                planId={event.planId}
                eventId={event.eventId}
                phase={event.phase}
                declared={event.declaredAttendance}
                reconciliationStatus={event.reconciliationStatus}
                tension={event.tension}
                endpointFor={(planId) => `/api/calendar/plans/${planId}/attendance`}
                notEventEndpointFor={(eventId) => `/api/events/${eventId}/not-event`}
              />
            </div>
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
