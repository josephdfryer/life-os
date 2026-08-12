/**
 * Canonical comparison keys for contact identifiers.
 *
 * Matching compares these normalized keys; the values actually written to a
 * Person keep their original formatting. A contact carries every email and
 * phone its source knew about, because the secondary ones are usually the
 * strongest evidence that two records are the same human.
 */

// Gmail ignores dots in the local part, so joe.fryer@ and joefryer@ are one mailbox.
const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"])

export function normalizeEmailForMatch(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed) return null
  const at = trimmed.lastIndexOf("@")
  if (at <= 0 || at === trimmed.length - 1) return null

  let local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  if (!domain.includes(".")) return null

  // Sub-addressing: alice+newsletters@x.com and alice@x.com are the same mailbox.
  const plus = local.indexOf("+")
  if (plus > 0) local = local.slice(0, plus)
  if (DOT_INSENSITIVE_DOMAINS.has(domain)) local = local.replace(/\./g, "")

  return local ? `${local}@${domain}` : null
}

export function normalizePhoneForMatch(value: string | null | undefined): string | null {
  let digits = (value ?? "").replace(/\D/g, "").replace(/^00/, "")
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
  return digits.length >= 7 ? digits : null
}

/** Dedupe by comparison key, keeping the first-seen original formatting. */
function dedupeBy(
  values: (string | null | undefined)[],
  normalize: (value: string | null | undefined) => string | null,
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = normalize(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const trimmed = value!.trim()
    if (trimmed) result.push(trimmed)
  }
  return result
}

export const dedupeEmails = (values: (string | null | undefined)[]) => dedupeBy(values, normalizeEmailForMatch)
export const dedupePhones = (values: (string | null | undefined)[]) => dedupeBy(values, normalizePhoneForMatch)

/** Comparison-key sets, for "do these two records share any identifier?" checks. */
export const emailKeys = (values: (string | null | undefined)[]) =>
  new Set(values.map(normalizeEmailForMatch).filter((key): key is string => Boolean(key)))

export const phoneKeys = (values: (string | null | undefined)[]) =>
  new Set(values.map(normalizePhoneForMatch).filter((key): key is string => Boolean(key)))

/** True when the two identifier lists overlap on any normalized key. */
export function sharesAny(
  left: (string | null | undefined)[],
  right: (string | null | undefined)[],
  normalize: (value: string | null | undefined) => string | null,
): boolean {
  const keys = new Set(left.map(normalize).filter((key): key is string => Boolean(key)))
  if (!keys.size) return false
  return right.some(value => {
    const key = normalize(value)
    return key ? keys.has(key) : false
  })
}
