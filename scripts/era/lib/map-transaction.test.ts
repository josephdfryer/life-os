import assert from "node:assert/strict"
import { test } from "node:test"
import { mapEraTransaction, localMidnightUtc, subtypeFor, type EraTransaction } from "./map-transaction"

function txn(overrides: Partial<EraTransaction> = {}): EraTransaction {
  return {
    transaction_id: "utgr_abc",
    account_group_key: "uagr_1",
    account_name: "Platinum Card®",
    amount: -20,
    currency: "USD",
    description: "Summerlin Tennis Club",
    original_description: "SUMMERLIN TENNIS CLULAS VEGAS NV",
    transaction_date: "2026-07-08",
    posted_date: "2026-07-08",
    is_pending: false,
    category: "Dining out",
    category_key: "fcat_x",
    is_cash_outflow: true,
    ...overrides,
  }
}

test("money is stored as positive integer cents with direction carrying the sign", () => {
  const mapped = mapEraTransaction(txn({ amount: -20 }))
  assert.equal(mapped.amount, 2000)
  assert.equal(mapped.direction, "paid")
  assert.equal(typeof mapped.amount, "number")
  assert.ok(Number.isInteger(mapped.amount))
})

test("fractional cents do not drift", () => {
  // 0.1 + 0.2 territory: this must land exactly on 1999 cents, not 1998.9999.
  assert.equal(mapEraTransaction(txn({ amount: -19.99 })).amount, 1999)
  assert.equal(mapEraTransaction(txn({ amount: -0.07 })).amount, 7)
  assert.equal(mapEraTransaction(txn({ amount: -1234.56 })).amount, 123456)
})

test("direction comes from is_cash_outflow, never the sign of amount", () => {
  // Era sends a NEGATIVE amount for money going out — the opposite of most
  // aggregators. A positive amount with is_cash_outflow true is still an outflow.
  assert.equal(mapEraTransaction(txn({ amount: 20, is_cash_outflow: true })).direction, "paid")
  assert.equal(mapEraTransaction(txn({ amount: -20, is_cash_outflow: false })).direction, "received")
})

test("transfers are typed as transfers regardless of direction", () => {
  const mapped = mapEraTransaction(txn({ category: "Transfers and card payments", is_cash_outflow: true }))
  assert.equal(mapped.direction, "transfer")
  assert.equal(mapped.subtype, "transfer")
  assert.equal(JSON.parse(mapped.metadata).transfer, true)
})

test("a credit in a spending category is a refund; in an income category, income", () => {
  assert.equal(subtypeFor("received", false, "Dining out"), "refund")
  assert.equal(subtypeFor("received", false, "Ride shares"), "refund")
  assert.equal(subtypeFor("received", false, "Paychecks"), "income")
  assert.equal(subtypeFor("received", false, "Interest and dividends"), "income")
  assert.equal(subtypeFor("received", false, "Side hustles and business"), "income")
  assert.equal(subtypeFor("paid", false, "Groceries"), "purchase")
})

test("dates anchor to local midnight Pacific, not UTC midnight", () => {
  // The bug this prevents: UTC midnight renders as the previous day in Pacific,
  // so "what did I spend yesterday" silently loses a day at the boundary.
  const summer = localMidnightUtc("2026-07-08") // PDT, UTC-7
  assert.equal(summer.toISOString(), "2026-07-08T07:00:00.000Z")

  const winter = localMidnightUtc("2026-01-15") // PST, UTC-8
  assert.equal(winter.toISOString(), "2026-01-15T08:00:00.000Z")

  // The rendered local date must match the date Era gave us, in both offsets.
  for (const ymd of ["2026-07-08", "2026-01-15", "2026-03-08", "2026-11-01"]) {
    const rendered = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(localMidnightUtc(ymd))
    assert.equal(rendered, ymd, `${ymd} must render as itself in Pacific`)
  }
})

test("merchant uses description, not merchant_name", () => {
  // merchant_name is frequently the payment rail or missing entirely.
  const mapped = mapEraTransaction(txn({ description: "Sprouts Farmers Market", merchant_name: "Google Pay" }))
  assert.equal(mapped.merchantName, "Sprouts Farmers Market")
  assert.match(mapped.summary, /^Sprouts Farmers Market · \$20\.00$/)
})

test("raw bank text is preserved for audit and place parsing", () => {
  const meta = JSON.parse(mapEraTransaction(txn()).metadata)
  assert.equal(meta.rawDescription, "SUMMERLIN TENNIS CLULAS VEGAS NV")
  assert.equal(meta.rawAmount, -20)
  assert.equal(meta.timePrecision, "day")
})

test("the dedupe anchor is the Era transaction id", () => {
  const mapped = mapEraTransaction(txn({ transaction_id: "utgr_GlzxYv1Dkmh" }))
  assert.equal(mapped.source, "era")
  assert.equal(mapped.sourceId, "utgr_GlzxYv1Dkmh")
})

test("a missing description still produces a usable record", () => {
  const mapped = mapEraTransaction(txn({ description: "", original_description: "RAW TEXT" }))
  assert.equal(mapped.merchantName, "RAW TEXT")
})
