// Shared LifeOS timezone resolution. ONE master timezone across every app:
// stored in a `tz` cookie scoped to the root domain (.lacollecteur.com) so every
// *.lacollecteur.com app reads the same value — settable at Home, detected from
// the browser on first visit. Pure helpers here are server-safe (no React, no
// DOM); the client writer is guarded and only touches document.cookie.

export const TZ_COOKIE = "tz"

// Fallback when no cookie is set and the browser hasn't been detected yet.
// Never UTC/server-local — that's exactly the bug this module fixes.
export const LIFE_OS_DEFAULT_TZ = "America/Los_Angeles"

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Resolve a raw cookie value (possibly URL-encoded, possibly empty/invalid) to a
// usable IANA timezone. Server components call this with the `tz` cookie value.
export function resolveTimeZone(raw?: string | null): string {
  if (!raw) return LIFE_OS_DEFAULT_TZ
  let value = raw
  try {
    value = decodeURIComponent(raw)
  } catch {
    // raw wasn't encoded; use as-is
  }
  value = value.trim()
  return isValidTimeZone(value) ? value : LIFE_OS_DEFAULT_TZ
}

// The browser's own timezone (client only).
export function detectBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || LIFE_OS_DEFAULT_TZ
  } catch {
    return LIFE_OS_DEFAULT_TZ
  }
}

// Read the tz cookie on the client.
export function readTzCookie(): string | null {
  if (typeof document === "undefined") return null
  const hit = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith(`${TZ_COOKIE}=`))
  return hit ? hit.slice(TZ_COOKIE.length + 1) : null
}

// Write the SHARED master cookie. On a *.lacollecteur.com host it scopes to the
// root domain so every app inherits it; elsewhere (local dev) it stays host-local.
export function writeTzCookie(tz: string): void {
  if (typeof document === "undefined") return
  const host = location.hostname
  const domain = host.endsWith("lacollecteur.com") ? "; domain=.lacollecteur.com" : ""
  const maxAge = 365 * 24 * 60 * 60
  document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=${maxAge}; SameSite=Lax${domain}`
}

export function dayKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

export function shiftDay(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function zonedDayBounds(value: string, timeZone: string) {
  return {
    start: zonedMidnight(value, timeZone),
    end: zonedMidnight(shiftDay(value, 1), timeZone),
  }
}

function zonedMidnight(value: string, timeZone: string) {
  const utcMidnight = new Date(`${value}T00:00:00Z`)
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(utcMidnight).find(part => part.type === "timeZoneName")?.value
  const match = offsetName?.match(/^GMT([+-])(\d{2}):(\d{2})$/)
  if (!match) return utcMidnight
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1)
  return new Date(utcMidnight.getTime() - minutes * 60_000)
}

// A curated shortlist for the picker; freeform entry is always allowed.
export const COMMON_TIME_ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
] as const
