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
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item: unknown) =>
      typeof item === "string"
        ? item.split(" ::: ").map(s => s.trim()).filter(Boolean)
        : []
    )
  } catch {
    // Raw legacy string (not JSON at all)
    return raw.split(" ::: ").map(s => s.trim()).filter(Boolean)
  }
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function formatBirthday(birthday: string | null): string | null {
  if (!birthday) return null
  const [, month, day] = birthday.split("-")
  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec",
  ]
  return `${months[parseInt(month, 10) - 1]} ${parseInt(day, 10)}`
}

export function daysUntilBirthday(birthday: string | null): number | null {
  if (!birthday) return null
  const today = new Date()
  const [, month, day] = birthday.split("-").map(Number)
  let next = new Date(today.getFullYear(), month - 1, day)
  if (next < today) {
    next = new Date(today.getFullYear() + 1, month - 1, day)
  }
  const diff = next.getTime() - today.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export function isBirthdayToday(birthday: string | null): boolean {
  if (!birthday) return false
  const today = new Date()
  const [, month, day] = birthday.split("-").map(Number)
  return today.getMonth() + 1 === month && today.getDate() === day
}

export function isBirthdayThisWeek(birthday: string | null): boolean {
  if (!birthday) return false
  const days = daysUntilBirthday(birthday)
  return days !== null && days > 0 && days <= 7
}
