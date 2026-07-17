import assert from "node:assert/strict"
import test from "node:test"
import { listGoogleCalendarEventPages } from "../server/integrations/google/calendar-client"
import { googleEventMetadata, parseGoogleDate } from "../server/integrations/google/calendar-event-parser"
import type { FetchLike } from "../server/integrations/google/client"

test("calendar parser handles timed and all-day events and produces stable metadata", () => {
  assert.equal(parseGoogleDate({ dateTime: "2026-07-16T09:30:00-07:00" })?.toISOString(), "2026-07-16T16:30:00.000Z")
  assert.equal(parseGoogleDate({ date: "2026-07-17" })?.toISOString(), "2026-07-17T00:00:00.000Z")
  assert.equal(parseGoogleDate({ dateTime: "invalid" }), null)

  const metadata = googleEventMetadata({
    id: "event-1",
    iCalUID: "ical-1",
    attendees: [{ email: "person@example.com", self: false, responseStatus: "accepted" }],
  }, "team@example.com")
  assert.equal(metadata.source, "google-calendar")
  assert.equal(metadata.googleEventKey, "team@example.com:event-1")
  assert.deepEqual(metadata.attendees, [{ email: "person@example.com", displayName: null, responseStatus: "accepted", self: false }])
})

test("calendar client paginates fixture responses and preserves the terminal sync token", async () => {
  const urls: string[] = []
  const fetchImpl: FetchLike = async input => {
    const url = String(input)
    urls.push(url)
    return url.includes("pageToken=page-2")
      ? Response.json({ items: [{ id: "two" }], nextSyncToken: "sync-next" })
      : Response.json({ items: [{ id: "one" }], nextPageToken: "page-2" })
  }
  const pages: string[][] = []
  const result = await listGoogleCalendarEventPages({
    accessToken: "token",
    calendarId: "team/calendar",
    syncToken: "sync-current",
    backfillDays: 30,
    fetchImpl,
    onPage: async items => { pages.push(items.map(item => item.id)) },
  })
  assert.deepEqual(pages, [["one"], ["two"]])
  assert.equal(result.nextSyncToken, "sync-next")
  assert.equal(result.usedSyncToken, true)
  assert.match(urls[0], /calendars\/team%2Fcalendar/)
  assert.match(urls[0], /syncToken=sync-current/)
  assert.match(urls[1], /pageToken=page-2/)
})

test("calendar client retries an expired incremental token as a bounded full sync", async () => {
  const urls: string[] = []
  const fetchImpl: FetchLike = async input => {
    const url = String(input)
    urls.push(url)
    if (urls.length === 1) return new Response("expired", { status: 410 })
    return Response.json({ items: [], nextSyncToken: "fresh-token" })
  }
  const result = await listGoogleCalendarEventPages({
    accessToken: "token",
    calendarId: "primary",
    syncToken: "expired-token",
    backfillDays: 7,
    now: new Date("2026-07-16T12:00:00.000Z"),
    fetchImpl,
    onPage: async () => undefined,
  })
  assert.equal(result.usedSyncToken, false)
  assert.equal(result.nextSyncToken, "fresh-token")
  assert.match(urls[0], /syncToken=expired-token/)
  assert.doesNotMatch(urls[1], /syncToken=/)
  assert.match(urls[1], /timeMin=2026-07-09T12%3A00%3A00.000Z/)
  assert.match(urls[1], /orderBy=startTime/)
})
