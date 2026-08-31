import { dayKey, zonedDayBounds } from "@life-os/ui"

// The Event table is a shared LifeOS graph: Places/Persons import Google Maps
// location history ("visit"/"visited_place"), communications land as
// "message"/"email", Stuff writes "stocktake"/"purchase_received", etc. Only
// genuinely *scheduled* events belong on the calendar. This allowlist is the
// single source of truth for "what the calendar shows" — Google-synced events
// (always type "calendar") plus the types a person can schedule by hand in the
// events/new form. Everything else stays in the timeline. Add a type here only
// when it is something a user schedules onto a calendar.
export const CALENDAR_EVENT_TYPES = [
  "calendar", // Google Calendar sync
  "meeting",
  "call",
  "dinner",
  "trip",
  "milestone",
  "other",
] as const

export type EventListView = "today" | "upcoming" | "past" | "all"

export function parseEventListView(value: string | undefined): EventListView {
  if (value === "today" || value === "upcoming" || value === "past" || value === "all") {
    return value
  }
  return "upcoming"
}

export function eventListWindow(view: EventListView, timeZone: string, now = new Date()) {
  const { start, end } = zonedDayBounds(dayKey(now, timeZone), timeZone)
  switch (view) {
    case "today":
      return { gte: start, lt: end }
    case "upcoming":
      return { gte: start }
    case "past":
      return { lt: start }
    case "all":
      return undefined
  }
}

export function formatEventTime(start: Date, end: Date | null, timeZone?: string) {
  const startDate = new Date(start)
  const sameDay = !end || new Date(end).toDateString() === startDate.toDateString()

  const date = startDate.toLocaleDateString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  })

  const time = startDate.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

  if (!end) return { date, time, range: time }

  const endTime = new Date(end).toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

  if (sameDay) return { date, time, range: `${time} – ${endTime}` }
  return { date, time, range: `${time} → ${endTime}` }
}

export function formatEventType(type: string) {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function parseEventMetadata(raw: string | null) {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}