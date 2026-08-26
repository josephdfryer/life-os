import assert from "node:assert/strict"
import test from "node:test"
import {
  isCalendarDbContention,
  mapPool,
  normalizeCalendarOccurrenceName,
  prioritizeCalendarConnections,
  sameCalendarOccurrence,
  walkEventPages,
  withCalendarDbRetry,
} from "./google-calendar-sync"

test("calendar sync retries Turso transaction-start failures", () => {
  assert.equal(isCalendarDbContention(new Error("Transaction API error: Unable to start a transaction in the given time.")), true)
  assert.equal(isCalendarDbContention(new Error("prisma:error SQLITE_BUSY: database is locked")), true)
  assert.equal(isCalendarDbContention({ code: "P2034", message: "Transaction failed due to a write conflict" }), true)
  assert.equal(isCalendarDbContention(new Error("Google Calendar events request failed (403)")), false)
})

test("calendar sync retries contention then succeeds", async () => {
  let attempts = 0
  const value = await withCalendarDbRetry(async () => {
    attempts += 1
    if (attempts < 3) throw new Error("Unable to start a transaction in the given time.")
    return "ok"
  })
  assert.equal(value, "ok")
  assert.equal(attempts, 3)
})

test("failed calendars sync before healthy ones so Sightmachine is not always last", () => {
  const ordered = prioritizeCalendarConnections([
    { calendarSummary: "Fryer den", lastError: null, lastSyncedAt: new Date("2026-08-16T20:00:00Z") },
    { calendarSummary: "JDF247", lastError: null, lastSyncedAt: new Date("2026-08-16T20:00:00Z") },
    { calendarSummary: "Qin", lastError: "Unable to start a transaction in the given time.", lastSyncedAt: new Date("2026-08-16T19:00:00Z") },
    { calendarSummary: "jfryer@sightmachine.com", lastError: "Unable to start a transaction in the given time.", lastSyncedAt: new Date("2026-08-15T12:00:00Z") },
  ]).map(connection => connection.calendarSummary)

  assert.deepEqual(ordered, ["jfryer@sightmachine.com", "Qin", "Fryer den", "JDF247"])
})

test("mapPool preserves order with limited concurrency", async () => {
  const seen: number[] = []
  const results = await mapPool([1, 2, 3, 4, 5], 2, async item => {
    seen.push(item)
    await new Promise(resolve => setTimeout(resolve, 5))
    return item * 10
  })
  assert.deepEqual(results, [10, 20, 30, 40, 50])
  assert.equal(seen.length, 5)
})

// ── Forward horizon / incremental bootstrap ─────────────────────────────────
// The bug these cover: every request used to carry timeMin/timeMax, which
// suppresses Google's nextSyncToken. The token was never obtained, incremental
// sync never activated, and the cron stayed pinned to a 7-day forward window,
// so no event further out than a week was ever pulled.

type FakeEvent = { id: string; status?: string; start?: { dateTime?: string; date?: string } }

function fakeGoogle(pages: Array<{ status?: number; ok?: boolean; page?: unknown }>) {
  const seen: URLSearchParams[] = []
  let i = 0
  return {
    seen,
    fetchPage: async (params: URLSearchParams) => {
      seen.push(new URLSearchParams(params.toString()))
      const next = pages[Math.min(i, pages.length - 1)]
      i++
      return { status: next.status ?? 200, ok: next.ok ?? true, page: next.page as never }
    },
  }
}

test("a full walk sends no date window, so Google can return a syncToken", async () => {
  const google = fakeGoogle([{ page: { items: [{ id: "a" }], nextSyncToken: "TOK1" } }])
  const collected: FakeEvent[] = []
  const result = await walkEventPages<FakeEvent>({
    syncToken: null, resumePageToken: null, ingestFrom: null,
    deadline: Date.now() + 60_000, pageSize: 100, batchSize: 25,
    fetchPage: google.fetchPage,
    onBatch: async items => { collected.push(...items) },
  })

  const params = google.seen[0]
  assert.equal(params.get("timeMin"), null, "timeMin must not be sent — it suppresses nextSyncToken")
  assert.equal(params.get("timeMax"), null, "timeMax must not be sent — it suppresses nextSyncToken")
  assert.equal(params.get("orderBy"), null, "orderBy must not be sent — it suppresses nextSyncToken")
  assert.equal(result.nextSyncToken, "TOK1")
  assert.equal(result.usedSyncToken, false)
  assert.equal(result.pendingPageToken, undefined)
  assert.deepEqual(collected.map(e => e.id), ["a"])
})

test("an established syncToken drives incremental sync with no window", async () => {
  const google = fakeGoogle([{ page: { items: [{ id: "b" }], nextSyncToken: "TOK2" } }])
  const result = await walkEventPages<FakeEvent>({
    syncToken: "TOK1", resumePageToken: null, ingestFrom: null,
    deadline: Date.now() + 60_000, pageSize: 100, batchSize: 25,
    fetchPage: google.fetchPage,
    onBatch: async () => {},
  })
  assert.equal(google.seen[0].get("syncToken"), "TOK1")
  assert.equal(google.seen[0].get("timeMin"), null)
  assert.equal(result.usedSyncToken, true)
  assert.equal(result.nextSyncToken, "TOK2")
})

test("a full walk that exceeds its budget parks a cursor instead of losing progress", async () => {
  const google = fakeGoogle([
    { page: { items: [{ id: "p1" }], nextPageToken: "PAGE2" } },
    { page: { items: [{ id: "p2" }], nextPageToken: "PAGE3" } },
  ])
  let clock = 1000
  const result = await walkEventPages<FakeEvent>({
    syncToken: null, resumePageToken: null, ingestFrom: null,
    deadline: 1500, pageSize: 100, batchSize: 25,
    now: () => (clock += 1000), // blows the budget after the first page
    fetchPage: google.fetchPage,
    onBatch: async () => {},
  })
  assert.equal(result.pendingPageToken, "PAGE2", "must hand back the cursor to resume from")
  assert.equal(result.nextSyncToken, undefined, "no token yet — the walk is unfinished")
})

test("the next run resumes from the parked cursor rather than restarting", async () => {
  const google = fakeGoogle([{ page: { items: [{ id: "p2" }], nextSyncToken: "TOKEND" } }])
  const result = await walkEventPages<FakeEvent>({
    syncToken: null, resumePageToken: "PAGE2", ingestFrom: null,
    deadline: Date.now() + 60_000, pageSize: 100, batchSize: 25,
    fetchPage: google.fetchPage,
    onBatch: async () => {},
  })
  assert.equal(google.seen[0].get("pageToken"), "PAGE2")
  assert.equal(google.seen[0].get("syncToken"), null, "a page cursor must travel alone")
  assert.equal(result.nextSyncToken, "TOKEND")
})

test("an expired syncToken (410) falls back to a fresh full walk", async () => {
  const google = fakeGoogle([
    { status: 410, ok: false },
    { page: { items: [{ id: "x" }], nextSyncToken: "FRESH" } },
  ])
  const result = await walkEventPages<FakeEvent>({
    syncToken: "STALE", resumePageToken: null, ingestFrom: null,
    deadline: Date.now() + 60_000, pageSize: 100, batchSize: 25,
    fetchPage: google.fetchPage,
    onBatch: async () => {},
  })
  assert.equal(result.usedSyncToken, false)
  assert.equal(result.nextSyncToken, "FRESH")
  assert.equal(google.seen[1].get("syncToken"), null, "the retry must be a clean full walk")
})

test("a stale parked cursor (400) restarts the walk instead of wedging", async () => {
  const google = fakeGoogle([
    { status: 400, ok: false },
    { page: { items: [{ id: "y" }], nextSyncToken: "OK" } },
  ])
  const result = await walkEventPages<FakeEvent>({
    syncToken: null, resumePageToken: "DEAD_CURSOR", ingestFrom: null,
    deadline: Date.now() + 60_000, pageSize: 100, batchSize: 25,
    fetchPage: google.fetchPage,
    onBatch: async () => {},
  })
  assert.equal(google.seen[1].get("pageToken"), null)
  assert.equal(result.nextSyncToken, "OK")
})

test("ingestFrom bounds history without ever filtering future events", async () => {
  const day = 86_400_000
  const cutoff = new Date(Date.now() - 30 * day)
  const google = fakeGoogle([{
    page: {
      items: [
        { id: "ancient", start: { dateTime: new Date(Date.now() - 900 * day).toISOString() } },
        { id: "recent", start: { dateTime: new Date(Date.now() - 5 * day).toISOString() } },
        { id: "far-future", start: { dateTime: new Date(Date.now() + 900 * day).toISOString() } },
        { id: "deleted-no-start", status: "cancelled" },
      ],
      nextSyncToken: "T",
    },
  }])
  const collected: FakeEvent[] = []
  await walkEventPages<FakeEvent>({
    syncToken: null, resumePageToken: null, ingestFrom: cutoff,
    deadline: Date.now() + 60_000, pageSize: 100, batchSize: 25,
    fetchPage: google.fetchPage,
    onBatch: async items => { collected.push(...items) },
  })
  assert.deepEqual(
    collected.map(e => e.id).sort(),
    ["deleted-no-start", "far-future", "recent"],
    "history is bounded, the future never is, and cancellations always pass",
  )
})

test("calendar occurrence names normalize case and incidental spacing", () => {
  assert.equal(normalizeCalendarOccurrenceName("  TICO   <> SM Weekly Sync  "), "tico <> sm weekly sync")
})

test("same named calendar copies within five minutes are one occurrence", () => {
  assert.equal(sameCalendarOccurrence(
    { name: "Board Meeting", start: new Date("2026-08-22T18:00:00Z") },
    { name: " board   meeting ", start: new Date("2026-08-22T18:04:59Z") },
  ), true)
})

test("recurring same-name items at different times stay separate", () => {
  assert.equal(sameCalendarOccurrence(
    { name: "Workout", start: new Date("2026-08-22T18:00:00Z") },
    { name: "Workout", start: new Date("2026-08-23T18:00:00Z") },
  ), false)
})
