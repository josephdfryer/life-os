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

export function isProviderScheduledEvent(event: {
  type: string
  calendarLinks: readonly unknown[]
}) {
  return event.type === "calendar" || event.calendarLinks.length > 0
}
