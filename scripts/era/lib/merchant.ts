// Turning a bank descriptor into a merchant identity.
//
// Era's `description` is already cleaned, but it still carries the payment rail
// that processed the charge ("Gglpay Foxtail", "AplPay Dawgs House", "TST*
// Broken Coffee"), which fragments one merchant across several names. It also
// contains a lot of rows that are not merchants at all — ATM withdrawals,
// interest, card payments, transfers between your own accounts.
//
// Pure and dependency-free; tested in merchant.test.ts.

/**
 * Payment rails and acquirer prefixes. These say how the money moved, not who
 * received it, so they are stripped before identity is decided.
 */
const RAIL_PREFIXES = [
  /^ggl\s?pay\s+/i,      // Google Pay
  /^apl\s?pay\s+/i,      // Apple Pay
  /^tst\*\s*/i,          // Toast
  /^sq\s*\*\s*/i,        // Square
  /^fsp\*\s*/i,
  /^sp\s+(?=[a-z])/i,    // Shopify "SP " — only when a name follows
  /^py\s*\*\s*/i,
  /^in\s*\*\s*/i,
  /^pp\*\s*/i,           // PayPal
  /^paypal\s*\*\s*/i,
]

/**
 * Descriptors that are bank machinery rather than a counterparty. Creating a
 * "corporation" for these would be a lie: nobody sells you an ATM withdrawal.
 * Matched against the whole normalized name, not as substrings, so a real
 * merchant containing one of these words survives.
 */
const NON_MERCHANT_PATTERNS = [
  /^atm\s+(withdrawal|fee|deposit)/i,
  /^cash\s+(deposit|withdrawal)/i,
  /^(online\s+)?transfer(\s+(to|from)\b.*)?$/i,
  /^(zelle|venmo|wire)\s+transfer/i,
  /^payment$/i,
  /^automatic\s+payment/i,
  /^\w[\w\s]*\bcredit\s+card$/i,          // "American Express Credit Card"
  /^interest\s+(payment|charge)/i,
  /^(foreign\s+exchange\s+rate\s+)?adjustment/i,
  /^plan\s+fee\b/i,                        // Amex Plan It instalment fees
  /^(late|annual|service|overdraft)\s+fee/i,
  /^real\s+time\s+payment/i,
  /^check\s*#?\s*\d*$/i,
  /^deposit$/i,
  /^withdrawal$/i,
  /^balance\s+transfer/i,
  /^cash\s+advance/i,
  /^charge\s+on$/i,
  /^redemption\b/i,
  /^.*\bpayroll$/i,                        // "Sight Machine Payroll" is income
  // ACH descriptors that name a channel rather than a counterparty. These turn
  // up on incoming rows ("Online Deposit Check #1", "Discover Prearrange") and
  // would otherwise become five-figure "merchants".
  /^online\s+deposit/i,
  /\bepayment\b/i,
  /^discover\s+(prearrange|electrncbt|net\b)/i,
  // Era sometimes returns a bare fragment as the description — literally
  // "Online", "Online G", "Redeem". These name nothing, and left alone they
  // become five-figure "merchants" in the spend-by-counterparty view.
  /^online(\s+\w{1,2})?$/i,
  /^redeem(ption)?\b/i,
  /^misc(ellaneous)?$/i,
  /^purchase$/i,
  /^refund$/i,
  /^credit$/i,
  /^debit$/i,
]

/**
 * Bank channel suffixes. "Verizon Payment Web" and "Verizon" are the same
 * counterparty reached two ways; leaving the suffix on splits one merchant in
 * two and hides the real total.
 */
const CHANNEL_SUFFIXES = [
  /\s+(payment|remittance|billpay|bill\s*pay|auto\s*debit|autopay)\s*(web|ppd|ach)?$/i,
  /\s+e\s*check$/i,
  /\s+(web|ppd)\s*id$/i,
]

/** Strip the rail, collapse whitespace, drop trailing store/reference numbers. */
export function normalizeMerchantName(raw: string): string {
  let name = raw.trim()
  // Rails can stack ("AplPay TST* JUICEFARM").
  let changed = true
  while (changed) {
    changed = false
    for (const prefix of RAIL_PREFIXES) {
      const next = name.replace(prefix, "")
      if (next !== name) { name = next.trim(); changed = true }
    }
  }
  name = name
    // Trailing store/terminal numbers: "Petco 2128 21", "Target 00010546115".
    .replace(/[\s#*-]+\d{3,}[\d\s#-]*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()

  // Only strip a channel suffix when something is left behind — "Payment" on
  // its own is bank machinery, caught by isNonMerchant, not a merchant named "".
  for (const suffix of CHANNEL_SUFFIXES) {
    const stripped = name.replace(suffix, "").trim()
    if (stripped.length > 0 && stripped !== name) { name = stripped; break }
  }
  return name
}

/** Case- and punctuation-insensitive identity key for grouping. */
export function merchantKey(raw: string): string {
  return normalizeMerchantName(raw)
    .toLowerCase()
    .replace(/[.,'"’`]/g, "")
    .replace(/\s*&\s*/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * True when the descriptor is bank machinery rather than a counterparty.
 *
 * Tests both the raw and the normalized form, because channel stripping can
 * destroy the very evidence a pattern matches on: "Automatic Payment" loses its
 * " Payment" suffix and becomes "Automatic", which looks like a merchant.
 */
export function isNonMerchant(raw: string): boolean {
  const candidates = [raw.trim(), normalizeMerchantName(raw)]
  return NON_MERCHANT_PATTERNS.some(pattern => candidates.some(name => pattern.test(name)))
}

/**
 * A display name for the merchant Group: the most common original spelling,
 * so the graph shows "Foxtail Coffee Company" rather than a normalized slug.
 * Ties break toward the longer name, which is usually the more complete one.
 */
export function preferredDisplayName(variants: { name: string; count: number }[]): string {
  return [...variants]
    .sort((a, b) => b.count - a.count || b.name.length - a.name.length)
    .map(v => normalizeMerchantName(v.name))
    .find(name => name.length > 0) ?? variants[0].name
}
