export type GoogleCalendarEvent = {
  id: string
  iCalUID?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[]
  organizer?: { email?: string; displayName?: string; self?: boolean }
  creator?: { email?: string; displayName?: string; self?: boolean }
  updated?: string
}

export type CalendarEventMetadata = {
  htmlLink?: string | null
  location?: string | null
  start?: { dateTime?: string; date?: string; timeZone?: string } | null
  end?: { dateTime?: string; date?: string; timeZone?: string } | null
  attendees?: { email?: string | null; displayName?: string | null; responseStatus?: string | null; self?: boolean }[]
  organizer?: { email?: string; displayName?: string; self?: boolean } | null
  creator?: { email?: string; displayName?: string; self?: boolean } | null
}

export function parseGoogleDate(value: GoogleCalendarEvent["start"] | GoogleCalendarEvent["end"]) {
  const raw = value?.dateTime ?? value?.date
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

export function googleEventMetadata(item: GoogleCalendarEvent, calendarId: string) {
  return {
    source: "google-calendar",
    calendarId,
    googleEventId: item.id,
    googleEventKey: `${calendarId}:${item.id}`,
    iCalUID: item.iCalUID ?? null,
    status: item.status ?? null,
    htmlLink: item.htmlLink ?? null,
    location: item.location ?? null,
    start: item.start ?? null,
    end: item.end ?? null,
    updated: item.updated ?? null,
    attendees: (item.attendees ?? []).map(attendee => ({
      email: attendee.email ?? null,
      displayName: attendee.displayName ?? null,
      responseStatus: attendee.responseStatus ?? null,
      self: Boolean(attendee.self),
    })),
    organizer: item.organizer ?? null,
    creator: item.creator ?? null,
  }
}
