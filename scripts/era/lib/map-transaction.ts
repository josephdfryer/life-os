// The single definition of "what an Era transaction means in Life OS".
//
// Everything that ingests Era data — the live sync, the JSON-dump importer, the
// staged-row backfill — maps through here, so there is one place where the sign
// convention, the timezone anchor, and the refund/income split are decided.
//
// Pure and dependency-free on purpose: it is unit-tested in map-transaction.test.ts
// without a database.

/** Era's transaction shape, verified against the live MCP server. */
export type EraTransaction = {
  transaction_id: string
  account_group_key: string
  account_name?: string
  amount: number
  currency?: string
  /** Cleaned merchant descriptor. The primary matching signal. */
  description: string
  /** Frequently the payment rail ("Google Pay") or missing — do not trust it. */
  merchant_name?: string | null
  /** Raw bank text, usually ending in "CITY ST". Kept for audit + place parsing. */
  original_description?: string | null
  transaction_date: string
  posted_date?: string | null
  is_pending?: boolean
  category?: string | null
  category_key?: string | null
  /** Authoritative direction flag. Never infer direction from the sign of amount. */
  is_cash_outflow?: boolean
}

export const TRANSFER_CATEGORY = "Transfers and card payments"

// Money genuinely earned, as opposed to money coming back. A credit in a
// spending category ("Dining out") is a refund; a credit in one of these is income.
export const INCOME_CATEGORIES = new Set([
  "Paychecks",
  "Interest and dividends",
  "Side hustles and business",
])

const TZ = "America/Los_Angeles"

export type MappedTransaction = {
  type: "financial"
  subtype: string
  source: "era"
  sourceId: string
  timestamp: Date
  /** Integer minor units (cents). Always positive; `direction` carries the sign. */
  amount: number
  direction: "paid" | "received" | "transfer"
  currency: string
  category: string | null
  merchantName: string
  summary: string
  metadata: string
  billable: false
}

export function mapEraTransaction(txn: EraTransaction): MappedTransaction {
  const isTransfer = txn.category === TRANSFER_CATEGORY
  // is_cash_outflow is authoritative; the sign of `amount` is negative for
  // outflows, which is the opposite of what most aggregators do.
  const direction: MappedTransaction["direction"] = isTransfer
    ? "transfer"
    : txn.is_cash_outflow === false ? "received" : "paid"

  const merchantName = txn.description || txn.original_description || "unknown merchant"
  const amountAbs = Math.abs(txn.amount)

  return {
    type: "financial",
    subtype: subtypeFor(direction, isTransfer, txn.category ?? undefined),
    source: "era",
    sourceId: txn.transaction_id,
    timestamp: localMidnightUtc(txn.transaction_date),
    amount: Math.round(amountAbs * 100),
    direction,
    currency: txn.currency ?? "USD",
    category: txn.category ?? null,
    merchantName,
    summary: `${merchantName} · $${amountAbs.toFixed(2)}${direction === "received" ? " received" : ""}`,
    billable: false,
    metadata: JSON.stringify({
      eraAccountId: txn.account_group_key,
      accountName: txn.account_name ?? null,
      eraCategoryKey: txn.category_key ?? null,
      rawAmount: txn.amount,
      rawDescription: txn.original_description ?? null,
      postedDate: txn.posted_date ?? null,
      transfer: isTransfer,
      // Era dates carry no clock time; the reconciler matches on the whole day.
      timePrecision: "day",
    }),
  }
}

export function subtypeFor(direction: string, isTransfer: boolean, category?: string) {
  if (isTransfer) return "transfer"
  if (direction === "received") return category && INCOME_CATEGORIES.has(category) ? "income" : "refund"
  return "purchase"
}

/**
 * Era's transaction_date is a bare YYYY-MM-DD. Anchoring it to UTC midnight
 * makes it render as the PREVIOUS day in Pacific, so every day-boundary query
 * is off by one. Anchor to local midnight instead.
 */
export function localMidnightUtc(ymd: string): Date {
  const [year, month, day] = ymd.slice(0, 10).split("-").map(Number)
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0)
  // Two passes converge on the right offset across DST boundaries.
  for (let i = 0; i < 2; i += 1) {
    utc = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs(new Date(utc))
  }
  return new Date(utc)
}

function offsetMs(date: Date) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" })
    .formatToParts(date).find(p => p.type === "timeZoneName")?.value
  const m = part?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/)
  if (!m) return 0
  return (m[1] === "+" ? 1 : -1) * ((Number(m[2]) * 60) + Number(m[3] ?? 0)) * 60_000
}
