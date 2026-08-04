import assert from "node:assert/strict"
import { test } from "node:test"
import { normalizeMerchantName, merchantKey, isNonMerchant, preferredDisplayName } from "./merchant"

test("payment rails are stripped, including stacked ones", () => {
  assert.equal(normalizeMerchantName("Gglpay Foxtail"), "Foxtail")
  assert.equal(normalizeMerchantName("AplPay Dawgs House"), "Dawgs House")
  assert.equal(normalizeMerchantName("TST* Broken Coffee"), "Broken Coffee")
  assert.equal(normalizeMerchantName("SQ *CHEONGDAM-KISA"), "CHEONGDAM-KISA")
  // A rail on top of a rail — Apple Pay through Toast.
  assert.equal(normalizeMerchantName("AplPay TST* JUICEFARM"), "JUICEFARM")
})

test("trailing store and terminal numbers are dropped", () => {
  assert.equal(normalizeMerchantName("Petco 2128 21"), "Petco")
  assert.equal(normalizeMerchantName("WHOLEFDS SUM #10814"), "WHOLEFDS SUM")
  assert.equal(normalizeMerchantName("Target 000105461150"), "Target")
})

test("a merchant whose real name contains digits is not truncated", () => {
  // The rule requires 3+ digits at the END, so these survive intact.
  assert.equal(normalizeMerchantName("7-Eleven"), "7-Eleven")
  assert.equal(normalizeMerchantName("1-800 CONTACTS"), "1-800 CONTACTS")
})

test("rail variants of one merchant collapse to a single key", () => {
  const keys = new Set([
    merchantKey("Gglpay Foxtail"),
    merchantKey("foxtail"),
    merchantKey("FOXTAIL"),
    merchantKey("Foxtail."),
  ])
  assert.equal(keys.size, 1, "these are all the same merchant")
})

test("distinct merchants keep distinct keys", () => {
  assert.notEqual(merchantKey("Whole Foods"), merchantKey("Wholesale Club"))
  assert.notEqual(merchantKey("Apple"), merchantKey("Apple Bees"))
  // The investing app vs a pub — must not merge.
  assert.notEqual(merchantKey("Public"), merchantKey("Public House"))
})

test("ampersands normalize so one merchant does not split", () => {
  assert.equal(merchantKey("Scissors & Scotch"), merchantKey("Scissors and Scotch"))
})

test("bank machinery is excluded from merchant identity", () => {
  for (const descriptor of [
    "ATM Withdrawal", "ATM Fee", "Cash Deposit",
    "Online Transfer to Checking 4289", "Online Transfer from Checking 3762",
    "Zelle Transfer", "Transfer to Venmo",
    "Payment", "Automatic Payment", "American Express Credit Card",
    "Interest Payment", "Plan Fee Club Ace", "Foreign Exchange Rate Adjustment Fee",
    "Real Time Payment Credit", "Sight Machine Payroll", "Cash Advance", "Charge on",
  ]) {
    assert.equal(isNonMerchant(descriptor), true, `${descriptor} is not a merchant`)
  }
})

test("real merchants are never mistaken for bank machinery", () => {
  for (const merchant of [
    "Whole Foods", "Uber", "Petco", "Foxtail Coffee Company", "United Airlines",
    "Apple", "Target", "Amazon", "7-Eleven", "Shake Shack",
    // Contains "fee" but is a coffee shop, and "payment" is not the whole name.
    "Coffee Bean & Tea Leaf", "Bungalow Coffee",
  ]) {
    assert.equal(isNonMerchant(merchant), false, `${merchant} IS a merchant`)
  }
})

test("bank channel suffixes collapse into the real counterparty", () => {
  // "Verizon Payment Web" and "Verizon" are one merchant reached two ways;
  // leaving the suffix on splits the total across two nodes.
  assert.equal(merchantKey("Verizon Payment Web"), merchantKey("Verizon"))
  assert.equal(normalizeMerchantName("Redrockvillas Remittance Web"), "Redrockvillas")
  assert.equal(normalizeMerchantName("Ducati Fincl Auto Debit Web"), "Ducati Fincl")
  assert.equal(normalizeMerchantName("Red Rock Villas E Check"), "Red Rock Villas")
})

test("stripping a channel suffix never empties the name", () => {
  // "Payment" alone is bank machinery, not a merchant called "".
  assert.equal(normalizeMerchantName("Payment"), "Payment")
  assert.equal(isNonMerchant("Payment"), true)
})

test("ACH channel descriptors are not merchants", () => {
  for (const descriptor of [
    "Online Deposit Check #1", "Amex Epayment Loan",
    "Discover Prearrange", "Discover Electrncbt", "Discover Net",
  ]) {
    assert.equal(isNonMerchant(descriptor), true, `${descriptor} is a bank channel`)
  }
})

test("bare descriptor fragments Era sometimes returns are not merchants", () => {
  // These arrive as the whole `description` field, not as truncations we caused.
  for (const fragment of ["Online", "Online G", "Redeem", "Redemption", "Misc", "Purchase", "Credit", "Debit"]) {
    assert.equal(isNonMerchant(fragment), true, `"${fragment}" names no counterparty`)
  }
})

test("fragment rules do not swallow real merchants that start the same way", () => {
  assert.equal(isNonMerchant("Online Deposit Check"), true)   // still bank machinery
  assert.equal(isNonMerchant("Credit Karma"), false)
  assert.equal(isNonMerchant("Purchase Point Coffee"), false)
  assert.equal(isNonMerchant("Redeemer Church"), false)
})

test("a real merchant containing a channel word survives", () => {
  assert.equal(isNonMerchant("Verizon Payment Web"), false)
  assert.equal(isNonMerchant("Redrockvillas Remittance Web"), false)
})

test("display name prefers the most common spelling", () => {
  const name = preferredDisplayName([
    { name: "Gglpay Foxtail", count: 3 },
    { name: "Foxtail Coffee Company", count: 9 },
    { name: "foxtail", count: 1 },
  ])
  assert.equal(name, "Foxtail Coffee Company")
})

test("display name breaks ties toward the fuller name", () => {
  const name = preferredDisplayName([
    { name: "Sprouts", count: 4 },
    { name: "Sprouts Farmers Market", count: 4 },
  ])
  assert.equal(name, "Sprouts Farmers Market")
})
