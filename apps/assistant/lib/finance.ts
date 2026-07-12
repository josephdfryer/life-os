import { db } from "@/lib/db"

const TZ = "America/Los_Angeles"
const DEFAULT_LIMIT = 10

export type SpendBreakdownInput = {
  dateExpression?: string
  startDate?: string
  endDate?: string
  merchant?: string
  category?: string
  placeName?: string
  limit?: number
}

type SpendTransaction = {
  id: string
  source: "era_staged" | "interaction"
  sourceId?: string | null
  date: string
  timestamp: Date
  merchant: string
  category: string
  amount: number
  rawAmount?: number | null
  placeName?: string | null
  placeGooglePlaceId?: string | null
  status?: string | null
  summary?: string | null
}

type EraMeta = {
  amount?: number
  rawAmount?: number
  eraCategory?: string
  transfer?: boolean
  rawDescription?: string
  placeMatch?: {
    band?: string
    merchantPlace?: {
      name?: string
      googlePlaceId?: string | null
    } | null
  }
}

type InteractionMeta = {
  eraCategory?: string
  rawAmount?: number
  transfer?: boolean
  placeMatch?: EraMeta["placeMatch"]
}

export async function getSpendBreakdown(input: SpendBreakdownInput, workspaceId: string) {
  const range = resolveDateRange(input)
  const limit = Math.min(25, Math.max(3, Math.round(input.limit ?? DEFAULT_LIMIT)))
  const [eraRows, interactionRows, places] = await Promise.all([
    db.stagedInteraction.findMany({
      where: {
        workspaceId,
        source: "era",
        timestamp: { gte: range.start, lt: range.end },
      },
      select: {
        id: true,
        sourceId: true,
        timestamp: true,
        contactName: true,
        summary: true,
        status: true,
        interactionId: true,
        metadata: true,
      },
      orderBy: { timestamp: "asc" },
      take: 2000,
    }),
    db.interaction.findMany({
      where: {
        workspaceId,
        type: "financial",
        timestamp: { gte: range.start, lt: range.end },
        amount: { not: null },
      },
      select: {
        id: true,
        timestamp: true,
        summary: true,
        amount: true,
        direction: true,
        notes: true,
        place: { select: { name: true, googlePlaceId: true } },
      },
      orderBy: { timestamp: "asc" },
      take: 2000,
    }),
    db.place.findMany({
      where: { workspaceId, googlePlaceId: { not: null } },
      select: { name: true, googlePlaceId: true },
    }),
  ])

  const placeNameByGoogleId = new Map(places.map(place => [place.googlePlaceId!, place.name]))
  const linkedInteractionIds = new Set(eraRows.map(row => row.interactionId).filter((id): id is string => Boolean(id)))
  const transactions: SpendTransaction[] = []

  for (const row of eraRows) {
    const meta = parseJson<EraMeta>(row.metadata)
    if (!isPaidEraTransaction(meta)) continue
    const tx = eraTransactionFromRow(row, meta, placeNameByGoogleId)
    if (matchesFilters(tx, input)) transactions.push(tx)
  }

  for (const row of interactionRows) {
    if (linkedInteractionIds.has(row.id)) continue
    const meta = parseJson<InteractionMeta>(row.notes)
    if (meta?.transfer) continue
    if (row.direction && !["paid", "debit", "outflow"].includes(row.direction)) continue
    const tx = {
      id: row.id,
      source: "interaction" as const,
      date: localDateKey(row.timestamp),
      timestamp: row.timestamp,
      merchant: row.summary ?? "transaction",
      category: meta?.eraCategory ?? "uncategorized",
      amount: roundMoney(Math.abs(row.amount ?? 0)),
      rawAmount: meta?.rawAmount ?? null,
      placeName: row.place?.name ?? placeNameFromMatch(meta?.placeMatch, placeNameByGoogleId),
      placeGooglePlaceId: row.place?.googlePlaceId ?? meta?.placeMatch?.merchantPlace?.googlePlaceId ?? null,
      summary: row.summary,
    }
    if (tx.amount > 0 && matchesFilters(tx, input)) transactions.push(tx)
  }

  transactions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id))
  const total = roundMoney(transactions.reduce((sum, tx) => sum + tx.amount, 0))

  return {
    range: {
      label: range.label,
      startDate: range.startDate,
      endDate: range.endDate,
      timezone: TZ,
    },
    filters: {
      merchant: cleanOptional(input.merchant),
      category: cleanOptional(input.category),
      placeName: cleanOptional(input.placeName),
    },
    total,
    transactionCount: transactions.length,
    byMerchant: topGroups(transactions, tx => tx.merchant, limit),
    byCategory: topGroups(transactions, tx => tx.category, limit),
    byPlace: topGroups(transactions.filter(tx => tx.placeName), tx => tx.placeName ?? "Unknown place", limit),
    largestTransactions: [...transactions]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit)
      .map(tx => ({
        date: tx.date,
        merchant: tx.merchant,
        category: tx.category,
        place: tx.placeName ?? null,
        amount: tx.amount,
        id: tx.id,
        source: tx.source,
      })),
    sampleTransactions: transactions.slice(0, limit).map(tx => ({
      date: tx.date,
      merchant: tx.merchant,
      category: tx.category,
      place: tx.placeName ?? null,
      amount: tx.amount,
    })),
  }
}

function eraTransactionFromRow(
  row: {
    id: string
    sourceId: string
    timestamp: Date
    contactName: string | null
    summary: string | null
    status: string
  },
  meta: EraMeta | null,
  placeNameByGoogleId: Map<string, string>,
): SpendTransaction {
  return {
    id: row.id,
    source: "era_staged",
    sourceId: row.sourceId,
    date: localDateKey(row.timestamp),
    timestamp: row.timestamp,
    merchant: row.contactName ?? meta?.rawDescription ?? row.summary ?? "unknown merchant",
    category: meta?.eraCategory ?? "uncategorized",
    amount: roundMoney(Math.abs(Number(meta?.amount ?? meta?.rawAmount ?? 0))),
    rawAmount: typeof meta?.rawAmount === "number" ? meta.rawAmount : null,
    placeName: placeNameFromMatch(meta?.placeMatch, placeNameByGoogleId),
    placeGooglePlaceId: meta?.placeMatch?.merchantPlace?.googlePlaceId ?? null,
    status: row.status,
    summary: row.summary,
  }
}

function isPaidEraTransaction(meta: EraMeta | null) {
  if (!meta || meta.transfer) return false
  if (typeof meta.rawAmount === "number") return meta.rawAmount < 0
  return typeof meta.amount === "number" && meta.amount > 0
}

function placeNameFromMatch(match: EraMeta["placeMatch"] | undefined, placeNameByGoogleId: Map<string, string>) {
  if (!match?.merchantPlace || !["auto", "adjudicated"].includes(match.band ?? "")) return null
  const googlePlaceId = match.merchantPlace.googlePlaceId
  return (googlePlaceId ? placeNameByGoogleId.get(googlePlaceId) : null) ?? match.merchantPlace.name ?? null
}

function matchesFilters(tx: SpendTransaction, input: SpendBreakdownInput) {
  const merchant = cleanOptional(input.merchant)?.toLowerCase()
  const category = cleanOptional(input.category)?.toLowerCase()
  const place = cleanOptional(input.placeName)?.toLowerCase()
  if (merchant && !tx.merchant.toLowerCase().includes(merchant)) return false
  if (category && !tx.category.toLowerCase().includes(category)) return false
  if (place && !(tx.placeName ?? "").toLowerCase().includes(place)) return false
  return true
}

function topGroups(transactions: SpendTransaction[], keyFor: (tx: SpendTransaction) => string, limit: number) {
  const groups = new Map<string, { total: number; count: number }>()
  for (const tx of transactions) {
    const key = keyFor(tx) || "uncategorized"
    const current = groups.get(key) ?? { total: 0, count: 0 }
    current.total = roundMoney(current.total + tx.amount)
    current.count += 1
    groups.set(key, current)
  }
  return [...groups.entries()]
    .map(([name, value]) => ({ name, total: value.total, count: value.count }))
    .sort((a, b) => b.total - a.total || b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

function resolveDateRange(input: SpendBreakdownInput) {
  if (isDateOnly(input.startDate)) {
    const startDate = input.startDate!
    const endDate = isDateOnly(input.endDate) ? input.endDate! : startDate
    return rangeFromDates(startDate, addDays(endDate, 1), `${startDate}${endDate !== startDate ? ` through ${endDate}` : ""}`)
  }

  const expression = (input.dateExpression ?? "last 30 days").trim().toLowerCase()
  const today = localDateKey(new Date())
  if (expression === "today") return rangeFromDates(today, addDays(today, 1), "today")
  if (expression === "yesterday") {
    const day = addDays(today, -1)
    return rangeFromDates(day, addDays(day, 1), "yesterday")
  }
  if (isDateOnly(expression)) return rangeFromDates(expression, addDays(expression, 1), expression)
  if (/^\d{4}-\d{2}$/.test(expression)) {
    return rangeFromDates(`${expression}-01`, addMonths(`${expression}-01`, 1), expression)
  }

  const lastDays = expression.match(/^last\s+(\d{1,3})\s+days?$/)
  if (lastDays) {
    const days = Math.min(365, Math.max(1, Number(lastDays[1])))
    return rangeFromDates(addDays(today, -(days - 1)), addDays(today, 1), `last ${days} days`)
  }

  if (expression === "this week") {
    const start = addDays(today, -localWeekdayIndex(today))
    return rangeFromDates(start, addDays(today, 1), "this week")
  }
  if (expression === "last week") {
    const thisWeekStart = addDays(today, -localWeekdayIndex(today))
    const start = addDays(thisWeekStart, -7)
    return rangeFromDates(start, thisWeekStart, "last week")
  }
  if (expression === "this month") return rangeFromDates(monthStart(today), addDays(today, 1), "this month")
  if (expression === "last month") {
    const thisMonth = monthStart(today)
    const start = addMonths(thisMonth, -1)
    return rangeFromDates(start, thisMonth, "last month")
  }

  const month = monthExpression(expression)
  if (month) return rangeFromDates(month, addMonths(month, 1), expression)

  return rangeFromDates(addDays(today, -29), addDays(today, 1), "last 30 days")
}

function rangeFromDates(startDate: string, endExclusiveDate: string, label: string) {
  return {
    label,
    startDate,
    endDate: addDays(endExclusiveDate, -1),
    start: zonedTimeToUtc(startDate, 0, 0, 0),
    end: zonedTimeToUtc(endExclusiveDate, 0, 0, 0),
  }
}

function monthExpression(expression: string) {
  const match = expression.match(/^(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?$/)
  if (!match) return null
  const monthIndex = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(match[1])
  const year = match[2] ? Number(match[2]) : Number(localDateKey(new Date()).slice(0, 4))
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`
}

function localWeekdayIndex(ymd: string) {
  const date = new Date(`${ymd}T12:00:00Z`)
  const day = date.getUTCDay()
  return day === 0 ? 6 : day - 1
}

function monthStart(ymd: string) {
  return `${ymd.slice(0, 7)}-01`
}

function localDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function zonedTimeToUtc(ymd: string, hour: number, minute: number, second: number) {
  const [year, month, day] = ymd.split("-").map(Number)
  let utc = Date.UTC(year, month - 1, day, hour, minute, second)
  for (let i = 0; i < 2; i += 1) {
    utc = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs(new Date(utc))
  }
  return new Date(utc)
}

function offsetMs(date: Date) {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "shortOffset",
  }).formatToParts(date).find(item => item.type === "timeZoneName")?.value
  const match = part?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/)
  if (!match) return 0
  const sign = match[1] === "+" ? 1 : -1
  return sign * ((Number(match[2]) * 60) + Number(match[3] ?? 0)) * 60_000
}

function isDateOnly(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function addDays(ymd: string, days: number) {
  const [year, month, day] = ymd.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function addMonths(ymd: string, months: number) {
  const [year, month] = ymd.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1 + months, 1))
  return date.toISOString().slice(0, 10)
}

function cleanOptional(value?: string) {
  const clean = value?.trim()
  return clean ? clean : undefined
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}
