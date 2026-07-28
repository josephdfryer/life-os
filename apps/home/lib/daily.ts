export type ActionItem = {
  description: string
  completed: boolean
}

export function parseActionItems(value: string | null): ActionItem[] {
  if (!value?.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return [{ description: value.trim(), completed: false }]
    return parsed.flatMap((item): ActionItem[] => {
      if (typeof item === "string" && item.trim()) {
        return [{ description: item.trim(), completed: false }]
      }
      if (!item || typeof item !== "object") return []
      const record = item as Record<string, unknown>
      const description =
        typeof record.description === "string"
          ? record.description.trim()
          : typeof record.text === "string"
            ? record.text.trim()
            : ""
      return description ? [{ description, completed: record.completed === true }] : []
    })
  } catch {
    return [{ description: value.trim(), completed: false }]
  }
}

export function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

export const HOME_TIME_ZONE = "America/Los_Angeles"

export function dayKey(date: Date, timeZone = HOME_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

export function parseReviewDay(value: string | undefined, now = new Date(), timeZone = HOME_TIME_ZONE) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return dayKey(now, timeZone)
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? dayKey(now, timeZone) : value
}

export function shiftDay(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function reviewDayBounds(value: string, timeZone = HOME_TIME_ZONE) {
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

export function isProviderScheduledEvent(event: {
  type: string
  calendarLinks: readonly unknown[]
}) {
  return event.type === "calendar" || event.calendarLinks.length > 0
}
