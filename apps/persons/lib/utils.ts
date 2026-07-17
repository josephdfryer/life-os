import { birthdayMonthDay, normalizeBirthday } from "./birthday"
import { decodeStoredJson, storedRecord, storedStringList } from "@life-os/contracts"

export function relativeTime(date: Date | string | null): string {
  if (!date) return "Never"
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

export function closenessLabel(n: number): string {
  return { 1: "Acquaintance", 2: "Nurture", 3: "Friend", 4: "Inner Circle" }[n] ?? "Unknown"
}

export function closenessWidth(n: number): string {
  return { 1: "25%", 2: "50%", 3: "75%", 4: "100%" }[n] ?? "0%"
}

export function parseTags(raw: string | string[] | null | undefined): string[] {
  if (!raw) return []
  // Already a parsed array — flatten any legacy ::: elements within
  if (Array.isArray(raw)) {
    return raw.flatMap(item =>
      typeof item === "string"
        ? item.split(" ::: ").map(s => s.trim()).filter(Boolean)
        : []
    )
  }
  if (raw.trim().startsWith("[")) {
    return decodeStoredJson(raw, storedStringList, "stored string list", [])
      .flatMap(item => item.split(" ::: ").map(s => s.trim()).filter(Boolean))
  }
  // Raw legacy string (not JSON at all).
  return raw.split(" ::: ").map(s => s.trim()).filter(Boolean)
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  return decodeStoredJson(raw, storedStringList, "stored string list", [])
}

export function parseStoredRecord(raw: string | null | undefined, field = "stored metadata") {
  return decodeStoredJson(raw, storedRecord, field, {})
}

export function formatBirthday(birthday: string | null): string | null {
  const parts = birthdayMonthDay(birthday)
  if (!parts) return null
  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec",
  ]
  return `${months[parts.month - 1]} ${parts.day}`
}

function localDateParts(tz: string): { year: number; month: number; day: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(new Date())
  return {
    year:  +p.find(x => x.type === "year")!.value,
    month: +p.find(x => x.type === "month")!.value,
    day:   +p.find(x => x.type === "day")!.value,
  }
}

export function isTimestampToday(timestamp: Date | string, tz = "UTC"): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz })
  return fmt.format(new Date(timestamp)) === fmt.format(new Date())
}

export function daysUntilBirthday(birthday: string | null, tz = "UTC"): number | null {
  const parts = birthdayMonthDay(birthday)
  if (!parts) return null
  const { year, month, day } = localDateParts(tz)
  const startOfToday = new Date(year, month - 1, day)
  let next = new Date(year, parts.month - 1, parts.day)
  if (next < startOfToday) {
    next = new Date(year + 1, parts.month - 1, parts.day)
  }
  const diff = next.getTime() - startOfToday.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export function isBirthdayToday(birthday: string | null, tz = "UTC"): boolean {
  const parts = birthdayMonthDay(birthday)
  if (!parts) return false
  const { month, day } = localDateParts(tz)
  return month === parts.month && day === parts.day
}

export function isBirthdayThisWeek(birthday: string | null, tz = "UTC"): boolean {
  if (!birthday) return false
  const days = daysUntilBirthday(birthday, tz)
  return days !== null && days > 0 && days <= 7
}

export function birthdayTurningAge(birthday: string | null, tz = "UTC"): number | null {
  const normalized = normalizeBirthday(birthday)
  if (!normalized) return null
  const fullMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!fullMatch) return null
  const birthYear = Number(fullMatch[1])
  const parts = birthdayMonthDay(birthday)
  if (!parts) return null
  const { year, month, day } = localDateParts(tz)
  const birthdayThisYear = new Date(year, parts.month - 1, parts.day)
  const today = new Date(year, month - 1, day)
  const ageYear = birthdayThisYear >= today ? year : year + 1
  return ageYear - birthYear
}
