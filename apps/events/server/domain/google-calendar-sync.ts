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
