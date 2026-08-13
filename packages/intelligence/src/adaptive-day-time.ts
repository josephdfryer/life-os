// Pure timezone/calendar-day arithmetic for the Adaptive Day engine. No date
// library dependency — the codebase doesn't have one, and the operations
// needed (resolve a local wall-clock time to a UTC instant, walk calendar
// days) are small enough to implement directly with Intl + Date.UTC.

function pad(n: number) {
  return String(n).padStart(2, "0")
}

// Resolves a wall-clock "day HH:mm" in a given IANA timezone to the
// corresponding UTC instant. Works by formatting a UTC guess in the target
// zone and correcting once by the observed offset — exact everywhere except
// within the DST-transition instant itself (a wall-clock time that either
// doesn't exist, e.g. 2:30am during a spring-forward, or exists twice, e.g.
// during a fall-back — both are edge-of-day cases the 8am-8pm candidate
// window never actually hits).
export function zonedTimeToUtc(day: string, hour: number, minute: number, timezone: string): Date {
  const guess = new Date(`${day}T${pad(hour)}:${pad(minute)}:00Z`)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(guess)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
  const observedHour = get("hour") === 24 ? 0 : get("hour")
  const observedUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), observedHour, get("minute"), get("second"))
  const [y, m, d] = day.split("-").map(Number)
  const desiredUtcMs = Date.UTC(y, m - 1, d, hour, minute, 0)
  const offsetMs = observedUtcMs - desiredUtcMs
  return new Date(guess.getTime() - offsetMs)
}

// The inverse: what local calendar day (and hour) does this UTC instant fall
// on in the given timezone.
export function localDayString(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")}`
}

export function localHour(instant: Date, timezone: string): number {
  const value = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(instant)
  const hour = Number(value)
  return hour === 24 ? 0 : hour
}

// Pure calendar-date-string arithmetic — never touches an instant/timezone,
// so it can't be affected by DST.
export function addDays(day: string, count: number): string {
  const [y, m, d] = day.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

export function roundUpToQuarterHour(instant: Date): Date {
  const ms = 15 * 60 * 1000
  return new Date(Math.ceil(instant.getTime() / ms) * ms)
}

export function formatSlot(slot: { start: Date; day: string }, timezone: string): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(slot.start)
  const today = localDayString(new Date(), timezone)
  return slot.day === today ? `${time} today` : `${time} on ${slot.day}`
}
