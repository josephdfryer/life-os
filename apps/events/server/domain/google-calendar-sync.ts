export function isCalendarDbContention(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : ""
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /SQLITE_BUSY|database is locked|Unable to start a transaction|P2034|P1008/i.test(`${code} ${message}`)
}

export async function withCalendarDbRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      last = error
      if (!isCalendarDbContention(error) || attempt === attempts - 1) throw error
      await new Promise(resolve => setTimeout(resolve, 80 * 2 ** attempt + Math.floor(Math.random() * 40)))
    }
  }
  throw last
}

export function prioritizeCalendarConnections<T extends { lastError: string | null; lastSyncedAt: Date | null; calendarSummary: string | null }>(connections: T[]): T[] {
  return [...connections].sort((a, b) => {
    const aFailed = Boolean(a.lastError)
    const bFailed = Boolean(b.lastError)
    if (aFailed !== bFailed) return aFailed ? -1 : 1
    const at = a.lastSyncedAt?.getTime() ?? 0
    const bt = b.lastSyncedAt?.getTime() ?? 0
    if (at !== bt) return at - bt
    return (a.calendarSummary ?? "").localeCompare(b.calendarSummary ?? "")
  })
}

export const DUPLICATE_OCCURRENCE_WINDOW_MS = 5 * 60 * 1000

export function normalizeCalendarOccurrenceName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ")
}

// A repeated title is only the same occurrence when it lands at effectively
// the same time. The time guard keeps recurring names such as "Workout" or
// "Weekly sync" from collapsing across separate instances.
export function sameCalendarOccurrence(
  left: { name: string; start: Date },
  right: { name: string; start: Date },
) {
  return normalizeCalendarOccurrenceName(left.name) === normalizeCalendarOccurrenceName(right.name)
    && Math.abs(left.start.getTime() - right.start.getTime()) <= DUPLICATE_OCCURRENCE_WINDOW_MS
}

export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (!items.length) return []
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

// ── Event page walking ──────────────────────────────────────────────────────
// Kept here, free of any server import, so the paging state machine can be
// tested directly. google-calendar.ts supplies fetchPage/onBatch.

export type CalendarPageEvent = {
  id: string
  status?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
}

export type EventPage<T> = { items?: T[]; nextPageToken?: string; nextSyncToken?: string }
export type PageFetchResult<T> = { status: number; ok: boolean; page?: EventPage<T> }

// A cancellation always passes, whatever its date: a deletion arriving through
// incremental sync often carries no start at all, and dropping it would leave a
// ghost event that no later sync revisits.
export function shouldIngestEvent(item: CalendarPageEvent, ingestFrom: Date): boolean {
  if (item.status === "cancelled") return true
  const raw = item.start?.dateTime ?? item.start?.date
  if (!raw) return true
  const start = new Date(raw)
  if (Number.isNaN(start.getTime())) return true
  return start.getTime() >= ingestFrom.getTime()
}

// Three modes, chosen entirely by stored state:
//
//   incremental — a syncToken exists. Unwindowed by construction, so it sees
//                 changes at ANY date, including years out. Cheap: changes only.
//   full        — no syncToken yet. Walks the calendar with NO timeMin/timeMax/
//                 orderBy, because Google only returns nextSyncToken for a query
//                 free of those. This is the one-time price of getting a token.
//   resume      — a full walk that ran out of budget last run, continuing from
//                 the parked nextPageToken.
//
// A full walk can outlive one invocation, so it is bounded by `deadline`: on
// expiry it hands back the current cursor for the caller to park, and the next
// run resumes from it. Progress is never lost and never redone.
//
// `ingestFrom` bounds what the bootstrap WRITES, not what it reads: pages are
// walked to the end regardless (the token only arrives on the last page) but
// events starting before the cutoff are skipped rather than upserted. Future
// events are never filtered — that is the entire point.
export async function walkEventPages<T extends CalendarPageEvent>(input: {
  syncToken: string | null
  resumePageToken: string | null
  ingestFrom: Date | null
  deadline: number
  pageSize: number
  batchSize: number
  now?: () => number
  fetchPage: (params: URLSearchParams) => Promise<PageFetchResult<T>>
  onBatch: (items: T[]) => Promise<void>
}): Promise<{ nextSyncToken?: string; usedSyncToken: boolean; pendingPageToken?: string }> {
  const now = input.now ?? Date.now
  let pageToken: string | undefined = input.syncToken ? undefined : (input.resumePageToken ?? undefined)
  let nextSyncToken: string | undefined
  let useSyncToken = Boolean(input.syncToken)
  let usedSyncToken = useSyncToken
  let resuming = Boolean(pageToken)

  for (;;) {
    // The cursor that fetched THIS page, captured before it gets overwritten
    // by page.nextPageToken below. If a slow page forces a mid-page bail, we
    // park this instead of the (not-yet-earned) next cursor, so resume
    // refetches and reprocesses this exact page. onBatch is idempotent
    // (upsert-keyed), so redoing already-done batches costs time, not
    // correctness.
    const currentPageToken = pageToken
    const params = new URLSearchParams({
      maxResults: String(input.pageSize),
      showDeleted: "true",
      singleEvents: "true",
    })
    // A page cursor already encodes the original query, so it travels alone —
    // pairing it with syncToken is rejected by Google.
    if (pageToken) params.set("pageToken", pageToken)
    else if (useSyncToken && input.syncToken) params.set("syncToken", input.syncToken)
    // Deliberately no timeMin/timeMax/orderBy on the full walk: any of them
    // suppresses nextSyncToken, which is what pinned this sync to a 7-day
    // forward horizon indefinitely.

    const res = await input.fetchPage(params)

    // 410 GONE: the syncToken expired. Fall back to a fresh full walk.
    if (res.status === 410) {
      useSyncToken = false
      usedSyncToken = false
      pageToken = undefined
      resuming = false
      continue
    }
    // A parked cursor can go stale between runs; Google rejects it with 400.
    // Restart the walk rather than wedging forever on a dead cursor.
    if (res.status === 400 && resuming) {
      pageToken = undefined
      resuming = false
      continue
    }
    if (!res.ok) throw new Error(`Google Calendar events request failed (${res.status})`)

    const page = res.page ?? {}
    const all = page.items ?? []
    const items = input.ingestFrom
      ? all.filter(item => shouldIngestEvent(item, input.ingestFrom as Date))
      : all
    for (let i = 0; i < items.length; i += input.batchSize) {
      await input.onBatch(items.slice(i, i + input.batchSize))
      // Checked per batch, not just per page: a page can hold up to
      // pageSize items, and slow-enough per-item processing (contention
      // retries, extra lookups) can blow the whole budget before a full
      // page ever finishes — the previous per-page-only check never got a
      // chance to run, and Vercel killed the function outright instead of
      // this returning gracefully.
      if (!useSyncToken && now() >= input.deadline) {
        return { nextSyncToken, usedSyncToken, pendingPageToken: currentPageToken }
      }
    }

    pageToken = page.nextPageToken
    nextSyncToken = page.nextSyncToken ?? nextSyncToken
    resuming = false
    if (!pageToken) break
    // Out of budget mid-walk: park the cursor so the next run continues.
    if (!useSyncToken && now() >= input.deadline) {
      return { nextSyncToken, usedSyncToken, pendingPageToken: pageToken }
    }
  }

  return { nextSyncToken, usedSyncToken, pendingPageToken: undefined }
}
