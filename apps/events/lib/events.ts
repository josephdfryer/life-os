export type EventListView = "today" | "upcoming" | "past" | "all"

export function parseEventListView(value: string | undefined): EventListView {
  if (value === "today" || value === "upcoming" || value === "past" || value === "all") {
    return value
  }
  return "upcoming"
}

export function eventListWindow(view: EventListView, now = new Date()) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

  switch (view) {
    case "today":
      return { gte: dayStart, lte: dayEnd }
    case "upcoming":
      return { gte: dayStart }
    case "past":
      return { lt: dayStart }
    case "all":
      return undefined
  }
}

export function formatEventTime(start: Date, end: Date | null) {
  const startDate = new Date(start)
  const sameDay = !end || new Date(end).toDateString() === startDate.toDateString()

  const date = startDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })

  const time = startDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

  if (!end) return { date, time, range: time }

  const endTime = new Date(end).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

  if (sameDay) return { date, time, range: `${time} – ${endTime}` }
  return { date, time, range: `${time} → ${endTime}` }
}

export function formatEventType(type: string) {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function parseEventMetadata(raw: string | null) {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}