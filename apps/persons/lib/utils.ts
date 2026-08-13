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
    try {
      return decodeStoredJson(raw, storedStringList, "stored string list", [])
        .flatMap(item => item.split(" ::: ").map(s => s.trim()).filter(Boolean))
    } catch {
      // Legacy/corrupt value (e.g. an array containing objects). A display
      // helper must never 500 a whole page over one malformed field — salvage
      // any string elements and drop the rest.
      try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          return parsed
            .filter((item): item is string => typeof item === "string")
            .flatMap(item => item.split(" ::: ").map(s => s.trim()).filter(Boolean))
        }
      } catch {
        // fall through to legacy string handling
      }
      return []
    }
  }
  // Raw legacy string (not JSON at all).
  return raw.split(" ::: ").map(s => s.trim()).filter(Boolean)
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    return decodeStoredJson(raw, storedStringList, "stored string list", [])
  } catch {
    // Display helper — salvage string elements from a malformed value rather
    // than throwing and 500-ing the page.
    try {
      const parsed: unknown = JSON.parse(raw ?? "")
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string")
    } catch {
      // ignore
    }
    return []
  }
}

export function parseStoredRecord(raw: string | null | undefined, field = "stored metadata") {
  return decodeStoredJson(raw, storedRecord, field, {})
}

// formatBirthday, daysUntilBirthday, isBirthdayToday, isBirthdayThisWeek, and
// birthdayTurningAge moved to @life-os/alignment/pure — the birthday-today
// alignment signal (Home's Nudges widget, Persons' Needs Attention list) and
// this app's own display logic now share one definition. Re-exported below
// so every existing import site (`@/lib/utils`) keeps working unmodified.
export {
  formatBirthday,
  daysUntilBirthday,
  isBirthdayToday,
  isBirthdayThisWeek,
  birthdayTurningAge,
} from "@life-os/alignment/pure"

export function isTimestampToday(timestamp: Date | string, tz = "UTC"): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz })
  return fmt.format(new Date(timestamp)) === fmt.format(new Date())
}
