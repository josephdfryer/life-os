import assert from "node:assert/strict"
import test from "node:test"
import {
  isCalendarDbContention,
  isCalendarBootstrapping,
  isPrismaUniqueConstraint,
  mapPool,
  normalizeCalendarOccurrenceName,
  prioritizeCalendarConnections,
  sameCalendarOccurrence,
  walkEventPages,
  walkRecentEventPages,
  withCalendarDbRetry,
} from "./google-calendar-sync"

test("calendar sync retries transaction-start failures", () => {
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

test("a bootstrapping calendar stays ahead of incremental ones even after a partial run", () => {
  const ordered = prioritizeCalendarConnections([
    {
      calendarSummary: "JDF247",
      lastError: null,
      lastSyncedAt: new Date("2026-09-01T12:00:00Z"),
      syncTokenEncrypted: "tok",
      fullSyncPageToken: null,
    },
    {
      calendarSummary: "jfryer@sightmachine.com",
      lastError: null,
      lastSyncedAt: new Date("2026-09-02T18:57:00Z"),
      syncTokenEncrypted: null,
      fullSyncPageToken: "PAGE12",
    },
    {
      calendarSummary: "Qin",
      lastError: null,
      lastSyncedAt: new Date("2026-09-01T12:00:00Z"),
      syncTokenEncrypted: "tok",
      fullSyncPageToken: null,
    },
  ]).map(connection => connection.calendarSummary)

  assert.deepEqual(ordered, ["jfryer@sightmachine.com", "JDF247", "Qin"])
})

test("isCalendarBootstrapping treats a parked cursor or missing token as in-progress", () => {
  assert.equal(isCalendarBootstrapping({ fullSyncPageToken: "PAGE2", syncTokenEncrypted: null }), true)
  assert.equal(isCalendarBootstrapping({ fullSyncPageToken: null, syncTokenEncrypted: null }), true)
  assert.equal(isCalendarBootstrapping({ fullSyncPageToken: null, syncTokenEncrypted: "tok" }), false)
  assert.equal(isCalendarBootstrapping({}), false)
})

test("unique constraint detection covers Prisma P2002 and Event.sourcePlanId failures", () => {
  assert.equal(isPrismaUniqueConstraint({ code: "P2002", message: "Unique constraint failed" }), true)
  assert.equal(isPrismaUniqueConstraint(new Error("Invalid `prisma.event.updateMany()` invocation:\n\nUnique constraint failed on the constraint: `Event_sourcePlanId_key`")), true)
  assert.equal(isPrismaUniqueConstraint(new Error("Google Calendar events request failed (403)")), false)
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
    syncToken: null, resumePageToken: "PAGE1", ingestFrom: null,
    deadline: 1500, pageSize: 100, batchSize: 25,
    now: () => (clock += 1000), // blows the budget right after the first page's one batch
    fetchPage: google.fetchPage,
    onBatch: async () => {},
  })
  // The deadline fires inside page 1's own batch loop (see next test), so what
  // gets parked is the cursor that FETCHED page 1 — not page 1's nextPageToken
  // — because a slower page could still have unprocessed items left in it.
  assert.equal(result.pendingPageToken, "PAGE1", "must hand back the cursor that led to the unfinished page, not the next one")
  assert.equal(result.nextSyncToken, undefined, "no token yet — the walk is unfinished")
})

test("a slow batch mid-page parks that page's own cursor without skipping its later items", async () => {
  const google = fakeGoogle([
    { page: { items: [{ id: "p1a" }, { id: "p1b" }], nextPageToken: "PAGE2" } },
  ])
  const seenBatches: string[] = []
  let clock = 1000
  const result = await walkEventPages<FakeEvent>({
    syncToken: null, resumePageToken: null, ingestFrom: null,
    deadline: 1500, pageSize: 100, batchSize: 1, // one item per batch
    now: () => (clock += 1000), // deadline blown right after the first batch
    fetchPage: google.fetchPage,
    onBatch: async items => { seenBatches.push(...items.map(item => item.id)) },
  })
  assert.deepEqual(seenBatches, ["p1a"], "must stop before the page's second batch, not skip it silently")
  assert.equal(result.pendingPageToken, undefined, "no incoming cursor for the first page, so nothing to resume from but the start")
  assert.equal(google.seen.length, 1, "must not have fetched a second page")
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

test("the recent horizon walk is ordered by start time and uses a date window", async () => {
  const timeMin = new Date("2026-09-01T00:00:00Z")
  const timeMax = new Date("2026-09-16T00:00:00Z")
  const google = fakeGoogle([{
    page: { items: [{ id: "today-standup" }, { id: "today-plant-tour" }] },
  }])
  const collected: FakeEvent[] = []
  const result = await walkRecentEventPages<FakeEvent>({
    timeMin, timeMax,
    deadline: Date.now() + 60_000, pageSize: 100, batchSize: 25,
    fetchPage: google.fetchPage,
    onBatch: async items => { collected.push(...items) },
  })
  const params = google.seen[0]
  assert.equal(params.get("timeMin"), timeMin.toISOString())
  assert.equal(params.get("timeMax"), timeMax.toISOString())
  assert.equal(params.get("orderBy"), "startTime")
  assert.equal(params.get("syncToken"), null)
  assert.equal(result.truncated, false)
  assert.deepEqual(collected.map(e => e.id), ["today-standup", "today-plant-tour"])
})

test("a truncated recent horizon still returns today's already-fetched page", async () => {
  const google = fakeGoogle([
    { page: { items: [{ id: "today-1" }, { id: "today-2" }], nextPageToken: "PAGE2" } },
    { page: { items: [{ id: "next-week" }] } },
  ])
  const seen: string[] = []
  let clock = 1000
  const result = await walkRecentEventPages<FakeEvent>({
    timeMin: new Date("2026-09-02T00:00:00Z"),
    timeMax: new Date("2026-09-16T00:00:00Z"),
    deadline: 1500, pageSize: 100, batchSize: 1,
    now: () => (clock += 1000),
    fetchPage: google.fetchPage,
    onBatch: async items => { seen.push(...items.map(item => item.id)) },
  })
  assert.deepEqual(seen, ["today-1"])
  assert.equal(result.truncated, true)
  assert.equal(google.seen.length, 1)
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

// ── Incremental walks are budgeted (2026-09-06 outage) ─────────────────────
// Sightmachine's delta outgrew one run; incremental walks never checked their
// deadline, so Vercel killed the function before the new token was saved and
// the same, larger delta replayed every 15 minutes for two days.

test("an incremental walk that exceeds its budget parks the next page cursor and keeps the token in use", async () => {
  const google = fakeGoogle([
    { page: { items: [{ id: "d1" }], nextPageToken: "DELTA2" } },
    { page: { items: [{ id: "d2" }], nextSyncToken: "TOK2" } },
  ])
  let clock = 1000
  const result = await walkEventPages<FakeEvent>({
    syncToken: "TOK1", resumePageToken: null, ingestFrom: null,
    deadline: 2500, pageSize: 100, batchSize: 25,
    now: () => (clock += 1000), // 2000 after the batch (fine), 3000 at the page boundary (over)
    fetchPage: google.fetchPage,
    onBatch: async () => {},
  })
  assert.equal(google.seen.length, 1, "must stop before fetching the second delta page")
  assert.equal(result.usedSyncToken, true)
  assert.equal(result.truncated, true)
  assert.equal(result.pendingPageToken, "DELTA2")
  assert.equal(result.nextSyncToken, undefined, "no new token until the delta finishes")
})

test("a parked incremental cursor resumes with pageToken alone and finishes with the new token", async () => {
  const google = fakeGoogle([{ page: { items: [{ id: "d2" }], nextSyncToken: "TOK2" } }])
  const result = await walkEventPages<FakeEvent>({
    syncToken: "TOK1", resumePageToken: "DELTA2", ingestFrom: null,
    deadline: Date.now() + 60_000, pageSize: 100, batchSize: 25,
    fetchPage: google.fetchPage,
    onBatch: async () => {},
  })
  assert.equal(google.seen[0].get("pageToken"), "DELTA2")
  assert.equal(google.seen[0].get("syncToken"), null, "a page cursor must travel alone")
  assert.equal(result.usedSyncToken, true)
  assert.equal(result.nextSyncToken, "TOK2")
  assert.equal(result.truncated, false)
})

test("a stale parked incremental cursor (400) falls back to re-listing from the old token, not a full bootstrap", async () => {
  const google = fakeGoogle([
    { status: 400, ok: false },
    { page: { items: [{ id: "d" }], nextSyncToken: "TOK2" } },
  ])
  const result = await walkEventPages<FakeEvent>({
    syncToken: "TOK1", resumePageToken: "DEAD", ingestFrom: null,
    deadline: Date.now() + 60_000, pageSize: 100, batchSize: 25,
    fetchPage: google.fetchPage,
    onBatch: async () => {},
  })
  assert.equal(google.seen[1].get("pageToken"), null)
  assert.equal(google.seen[1].get("syncToken"), "TOK1", "must re-list the delta, not walk the whole calendar")
  assert.equal(result.usedSyncToken, true)
  assert.equal(result.nextSyncToken, "TOK2")
})

test("onProgress reports the cursor that fetches each page, so a hard stop can park it", async () => {
  const google = fakeGoogle([
    { page: { items: [{ id: "a" }], nextPageToken: "P2" } },
    { page: { items: [{ id: "b" }], nextSyncToken: "TOK" } },
  ])
  const cursors: Array<string | undefined> = []
  await walkEventPages<FakeEvent>({
    syncToken: null, resumePageToken: null, ingestFrom: null,
    deadline: Date.now() + 60_000, pageSize: 100, batchSize: 25,
    fetchPage: google.fetchPage,
    onBatch: async () => {},
    onProgress: p => cursors.push(p.currentPageToken),
  })
  assert.deepEqual(cursors, [undefined, "P2"])
})

test("mapPool stops starting items once shouldStop is true and leaves their slots empty", async () => {
  let started = 0
  const results = await mapPool(
    [1, 2, 3, 4, 5, 6],
    2,
    async n => { started += 1; await new Promise(r => setTimeout(r, 5)); return n * 10 },
    { shouldStop: () => started >= 3 },
  )
  assert.equal(results.length, 6)
  const done = results.filter(r => r !== undefined)
  assert.ok(done.length >= 3 && done.length <= 4, `expected 3-4 completed, got ${done.length}`)
  assert.equal(results[5], undefined, "the last item must never have started")
})
