export function normalizeBirthday(value: unknown): string | null {
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (!raw) return null

  const normalized = raw.replace(/^0000-/, "--")
  const partial = normalized.match(/^--(\d{2})-?(\d{2})$/)
    ?? normalized.match(/^(\d{2})-(\d{2})$/)
    ?? normalized.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (partial) return validMonthDay(partial[1], partial[2])

  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return validFullDate(iso[1], iso[2], iso[3])

  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return validFullDate(compact[1], compact[2], compact[3])

  const slash = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) return validFullDate(slash[3], slash[1], slash[2])

  const words = normalized.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  if (words) {
    const month = MONTHS[words[2].toLowerCase()]
    if (month) return validFullDate(words[3], month, words[1])
  }

  return null
}

export function birthdayMonthDay(value: string | null | undefined) {
  const normalized = normalizeBirthday(value)
  if (!normalized) return null
  const match = normalized.match(/(?:^--|^\d{4}-)(\d{2})-(\d{2})$/)
  if (!match) return null
  return { month: Number(match[1]), day: Number(match[2]) }
}

function validMonthDay(monthRaw: string, dayRaw: string) {
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const referenceYear = month === 2 && day === 29 ? 2024 : 2023
  const date = new Date(referenceYear, month - 1, day)
  if (date.getMonth() + 1 !== month || date.getDate() !== day) return null
  return `--${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function validFullDate(yearRaw: string, monthRaw: string, dayRaw: string) {
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if (!Number.isInteger(year) || year < 1) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
}
