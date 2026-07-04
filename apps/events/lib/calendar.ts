export type CalendarMode = "week" | "month"

export function parseCalendarMode(value: string | undefined): CalendarMode {
  return value === "month" ? "month" : "week"
}

export function parseCalendarDate(value: string | undefined) {
  if (!value) return startOfDay(new Date())
  const parsed = new Date(`${value}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return startOfDay(new Date())
  return startOfDay(parsed)
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

export function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

export function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function startOfWeek(date: Date) {
  const start = startOfDay(date)
  const day = start.getDay()
  return addDays(start, -day)
}

export function endOfWeek(date: Date) {
  return endOfDay(addDays(startOfWeek(date), 6))
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
}

export function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
}

export function daysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

export function toDateKey(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function formatMonthLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

export function formatWeekLabel(start: Date) {
  const end = addDays(start, 6)
  const sameMonth = start.getMonth() === end.getMonth()
  const startLabel = start.toLocaleDateString("en-US", { month: sameMonth ? undefined : "short", day: "numeric" })
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  return `${startLabel} – ${endLabel}`
}

export function calendarRange(mode: CalendarMode, anchor: Date) {
  if (mode === "month") {
    const start = startOfMonth(anchor)
    const gridStart = startOfWeek(start)
    const end = endOfMonth(anchor)
    const gridEnd = endOfWeek(end)
    return { start: gridStart, end: gridEnd, label: formatMonthLabel(anchor) }
  }

  const start = startOfWeek(anchor)
  const end = endOfWeek(anchor)
  return { start, end, label: formatWeekLabel(start) }
}

export function shiftCalendarAnchor(mode: CalendarMode, anchor: Date, direction: -1 | 1) {
  if (mode === "month") {
    return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
  }
  return addDays(anchor, direction * 7)
}

export function monthGridDays(anchor: Date) {
  const first = startOfMonth(anchor)
  const gridStart = startOfWeek(first)
  const total = 42
  return Array.from({ length: total }, (_, index) => addDays(gridStart, index))
}

export function weekGridDays(anchor: Date) {
  const start = startOfWeek(anchor)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}