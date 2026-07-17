import { googleFetch, type FetchLike } from "./client"
import type { GoogleCalendarEvent } from "./calendar-event-parser"

const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
const GOOGLE_PAGE_SIZE = 100

type EventsListResponse = {
  items?: GoogleCalendarEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

export async function listGoogleCalendarEventPages(input: {
  accessToken: string
  calendarId: string
  syncToken: string | null
  backfillDays: number
  now?: Date
  fetchImpl?: FetchLike
  onPage: (items: GoogleCalendarEvent[]) => Promise<void>
}) {
  let pageToken: string | undefined
  let nextSyncToken: string | undefined
  let useSyncToken = Boolean(input.syncToken)
  let usedSyncToken = useSyncToken
  const now = input.now?.getTime() ?? Date.now()

  for (;;) {
    const params = new URLSearchParams({
      maxResults: String(GOOGLE_PAGE_SIZE),
      showDeleted: "true",
      singleEvents: "true",
    })
    if (pageToken) params.set("pageToken", pageToken)
    if (useSyncToken && input.syncToken) {
      params.set("syncToken", input.syncToken)
    } else {
      usedSyncToken = false
      params.set("timeMin", new Date(now - input.backfillDays * 86_400_000).toISOString())
      params.set("timeMax", new Date(now + 365 * 86_400_000).toISOString())
      params.set("orderBy", "startTime")
    }

    const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events?${params}`
    const response = await googleFetch(url, input.accessToken, input.fetchImpl)
    if (response.status === 410 && useSyncToken) {
      useSyncToken = false
      usedSyncToken = false
      pageToken = undefined
      continue
    }
    if (!response.ok) throw new Error(`Google Calendar events request failed (${response.status})`)
    const data = await response.json() as EventsListResponse
    await input.onPage(data.items ?? [])
    pageToken = data.nextPageToken
    nextSyncToken = data.nextSyncToken ?? nextSyncToken
    if (!pageToken) break
  }

  return { nextSyncToken, usedSyncToken }
}
