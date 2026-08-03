import { db } from "@/lib/db"

// Spend queries against the canonical graph.
//
// Financial transactions are Interactions (docs/FINANCE_INTERACTION_MODEL_PLAN.md),
// with amount/category/merchant/actor as real indexed columns. So every number
// below is a SQL GROUP BY over an index — not a findMany of every row followed by
// JSON.parse and a reduce in JavaScript, which is what this file used to do while
// the data was stranded in the StagedInteraction review queue.

const TZ = "America/Los_Angeles"
const DEFAULT_LIMIT = 10
const WORKSPACE_FINANCIAL = { type: "financial", direction: "paid" }

export type SpendBreakdownInput = {
  dateExpression?: string
  startDate?: string
  endDate?: string
  merchant?: string
  category?: string
  placeName?: string
  limit?: number
  /** Scope to one person's own spending (an owned account). */
  actorPersonId?: string
  /** Scope to a household: members' personal spend + joint spend on shared accounts. */
  groupId?: string
}

type GroupRow = { name: string; total: number; count: number }

export async function getSpendBreakdown(input: SpendBreakdownInput, workspaceId: string) {
  const range = resolveDateRange(input)
  const limit = Math.min(25, Math.max(3, Math.round(input.limit ?? DEFAULT_LIMIT)))
  const scope = buildScope(input, workspaceId, range)

  const [totals, byCategory, byMerchant, byPlace, largest, sample] = await Promise.all([
    queryTotals(scope),
    queryGroup(scope, `COALESCE(NULLIF(i."category", ''), 'uncategorized')`, limit),
    queryGroup(scope, `COALESCE(NULLIF(i."merchantName", ''), i."summary", 'unknown merchant')`, limit),
    queryGroup(scope, `pl."name"`, limit, `AND i."placeId" IS NOT NULL`),
    queryTransactions(scope, limit, `i."amount" DESC`),
    queryTransactions(scope, limit, `i."timestamp" ASC`),
  ])

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
    total: totals.total,
    transactionCount: totals.count,
    byMerchant,
    byCategory,
    byPlace,
    largestTransactions: largest,
    sampleTransactions: sample.map(tx => ({
      date: tx.date,
      merchant: tx.merchant,
      category: tx.category,
      place: tx.place,
      amount: tx.amount,
    })),
  }
}

/** Spend grouped by physical Place — only location-resolved transactions. */
export async function getPlaceSpend(workspaceId: string, placeName?: string, dateExpression?: string) {
  const range = resolveDateRange({ dateExpression: dateExpression ?? "last 365 days" })
  const scope = buildScope({ placeName }, workspaceId, range)
  const rows = await queryGroup(scope, `pl."name"`, 25, `AND i."placeId" IS NOT NULL`)
  return { range: { label: range.label, startDate: range.startDate, endDate: range.endDate }, places: rows }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query construction
//
// Filters are assembled as a parameterised WHERE clause once and reused by every
// aggregate, so all six queries above see exactly the same slice of data.
// ─────────────────────────────────────────────────────────────────────────────

type Scope = { where: string; params: unknown[] }

function buildScope(input: SpendBreakdownInput, workspaceId: string, range: DateRange): Scope {
  const clauses = [`i."workspaceId" = ?`, `i."type" = ?`, `i."direction" = ?`, `i."timestamp" >= ?`, `i."timestamp" < ?`]
  // Bind Date objects, NEVER date strings. Timestamps are stored as
  // "…T07:00:00.000+00:00"; an ISO string ends in "Z", and since '+' sorts
  // before 'Z' the two compare unequal at the exact range boundary. That
  // silently dropped every transaction falling on the first instant of a range
  // (all of them, since Era dates land on local midnight) while leaking the
  // end-boundary day in. The driver binds a Date in the stored format.
  const params: unknown[] = [
    workspaceId,
    WORKSPACE_FINANCIAL.type,
    WORKSPACE_FINANCIAL.direction,
    range.start,
    range.end,
  ]

  // Transfers between your own accounts are not spending. `direction = 'paid'`
  // already excludes them (they carry direction 'transfer'), but be explicit so
  // a future subtype change cannot silently double-count a card payment.
  clauses.push(`(i."subtype" IS NULL OR i."subtype" <> 'transfer')`)

  const merchant = cleanOptional(input.merchant)
  if (merchant) {
    clauses.push(`(LOWER(COALESCE(i."merchantName", '')) LIKE ? OR LOWER(COALESCE(i."summary", '')) LIKE ?)`)
    params.push(`%${merchant.toLowerCase()}%`, `%${merchant.toLowerCase()}%`)
  }

  const category = cleanOptional(input.category)
  if (category) {
    clauses.push(`LOWER(COALESCE(i."category", '')) LIKE ?`)
    params.push(`%${category.toLowerCase()}%`)
  }

  const place = cleanOptional(input.placeName)
  if (place) {
    clauses.push(`LOWER(COALESCE(pl."name", '')) LIKE ?`)
    params.push(`%${place.toLowerCase()}%`)
  }

  if (input.actorPersonId) {
    clauses.push(`i."actorPersonId" = ?`)
    params.push(input.actorPersonId)
  }

  // Household scope: a member's own spending, OR joint spending attributed to
  // the group itself via a participant edge (shared accounts have no single owner).
  if (input.groupId) {
    clauses.push(`(
      EXISTS (SELECT 1 FROM "PersonGroup" pg WHERE pg."personId" = i."actorPersonId" AND pg."groupId" = ?)
      OR EXISTS (SELECT 1 FROM "InteractionParticipant" ip
                  WHERE ip."interactionId" = i."id" AND ip."entityType" = 'Group' AND ip."entityId" = ?)
    )`)
    params.push(input.groupId, input.groupId)
  }

  return { where: clauses.join(" AND "), params }
}

const FROM = `FROM "Interaction" i LEFT JOIN "Place" pl ON pl."id" = i."placeId"`

async function queryTotals(scope: Scope) {
  const rows = await db.$queryRawUnsafe<{ total: number | null; n: number }[]>(
    `SELECT SUM(i."amount") AS total, COUNT(*) AS n ${FROM} WHERE ${scope.where}`,
    ...scope.params,
  )
  return { total: centsToDollars(rows[0]?.total), count: Number(rows[0]?.n ?? 0) }
}

async function queryGroup(scope: Scope, keyExpression: string, limit: number, extra = ""): Promise<GroupRow[]> {
  // GROUP BY / ORDER BY use ordinals, and the aliases deliberately avoid the
  // names of any column on the joined tables. `AS name` + `GROUP BY name` binds
  // to Place."name" rather than the alias, which silently collapsed every
  // category into a single bucket keyed by whichever row SQLite saw first.
  const rows = await db.$queryRawUnsafe<{ bucket: string | null; total_cents: number | null; row_count: number }[]>(
    `SELECT ${keyExpression} AS bucket, SUM(i."amount") AS total_cents, COUNT(*) AS row_count
       ${FROM}
      WHERE ${scope.where} ${extra}
      GROUP BY 1
      ORDER BY 2 DESC, 3 DESC
      LIMIT ${limit}`,
    ...scope.params,
  )
  return rows
    .filter(row => row.bucket)
    .map(row => ({ name: String(row.bucket), total: centsToDollars(row.total_cents), count: Number(row.row_count) }))
}

async function queryTransactions(scope: Scope, limit: number, orderBy: string) {
  const rows = await db.$queryRawUnsafe<{
    id: string; ts: string; merchant: string | null; category: string | null; place: string | null; amount: number
  }[]>(
    // Aliases are qualified/unique for the same shadowing reason as queryGroup.
    `SELECT i."id" AS id, i."timestamp" AS ts,
            COALESCE(NULLIF(i."merchantName", ''), i."summary") AS merchant,
            i."category" AS category, pl."name" AS place, i."amount" AS amount
       ${FROM}
      WHERE ${scope.where}
      ORDER BY ${orderBy}
      LIMIT ${limit}`,
    ...scope.params,
  )
  return rows.map(row => ({
    date: localDateKey(new Date(row.ts)),
    merchant: row.merchant ?? "unknown merchant",
    category: row.category ?? "uncategorized",
    place: row.place ?? null,
    amount: centsToDollars(row.amount),
    id: row.id,
    source: "interaction" as const,
  }))
}

// Money is stored as integer cents; convert only at the presentation boundary.
function centsToDollars(cents: number | null | undefined) {
  return Math.round(Number(cents ?? 0)) / 100
}

// ─────────────────────────────────────────────────────────────────────────────
// Natural-language date ranges (unchanged behaviour — this part was already good)
// ─────────────────────────────────────────────────────────────────────────────

type DateRange = { label: string; startDate: string; endDate: string; start: Date; end: Date }

function resolveDateRange(input: SpendBreakdownInput): DateRange {
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

  const lastDays = expression.match(/^last\s+(\d{1,4})\s+days?$/)
  if (lastDays) {
    const days = Math.min(3650, Math.max(1, Number(lastDays[1])))
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
  if (expression === "this year") return rangeFromDates(`${today.slice(0, 4)}-01-01`, addDays(today, 1), "this year")

  const month = monthExpression(expression)
  if (month) return rangeFromDates(month, addMonths(month, 1), expression)

  return rangeFromDates(addDays(today, -29), addDays(today, 1), "last 30 days")
}

function rangeFromDates(startDate: string, endExclusiveDate: string, label: string): DateRange {
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
