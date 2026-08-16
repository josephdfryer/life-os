// Extracted from apps/persons/app/import/persons/matching.ts and
// apps/persons/lib/contact-values.ts (Track C-adjacent — device contacts
// ingest, apps/api/lib/device-ingest.ts, needs the exact same matching
// algorithm the CSV/vCard import UI already uses, and apps/api cannot import
// apps/persons' internals per this repo's app-isolation convention). The
// algorithm is unchanged; only the incoming/existing-person types are
// genericized away from apps/persons' local `ParsedContact`/`Person` shapes
// so both callers can use it without depending on each other.

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

export const DUPLICATE_THRESHOLD = 0.85
export const POSSIBLE_THRESHOLD = 0.70

/** An incoming contact from any source (CSV/vCard import, device Contacts sync, ...). */
export type MatchableContact = {
  first?: string | null
  last?: string | null
  company?: string | null
  title?: string | null
  headline?: string | null
  birthday?: string | null
  location?: string | null
  linkedin?: string | null
  twitter?: string | null
  website?: string | null
  facebook?: string | null
  instagram?: string | null
  notes?: string | null
  /** Primary email, tolerated for callers that only have one. */
  email?: string | null
  /** Primary phone, tolerated for callers that only have one. */
  phone?: string | null
  emails?: string[] | null
  phones?: string[] | null
}

/** An existing Person, reduced to the fields matching/fillable-field logic reads. */
export type MatchableExistingPerson = {
  id: string
  first: string
  last: string
  company: string | null
  title: string | null
  headline: string | null
  birthday: string | null
  location: string | null
  linkedin: string | null
  twitter: string | null
  website: string | null
  facebook: string | null
  instagram: string | null
  notes: string | null
  emails: string[]
  phones: string[]
}

export type MatchResult = {
  personId: string
  personName: string
  personEmail: string | null
  personCompany: string | null
  score: number
  reason: string
  fillableFields: Record<string, string>
  fillableCount: number
}

export function normalizeMatchText(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "") }

/**
 * A contact's identifiers, tolerating the single-primary-value shape. These
 * objects can cross a network boundary (an import preview API, a device
 * ingest payload), so a payload carrying only the primary must still match
 * rather than silently scoring zero.
 */
function contactEmails(contact: MatchableContact): string[] {
  return contact.emails?.length ? contact.emails : (contact.email ? [contact.email] : [])
}
function contactPhones(contact: MatchableContact): string[] {
  return contact.phones?.length ? contact.phones : (contact.phone ? [contact.phone] : [])
}

export function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const l1 = s1.length, l2 = s2.length
  if (!l1 || !l2) return 0
  const distance = Math.max(Math.floor(Math.max(l1, l2) / 2) - 1, 0)
  const first = new Array(l1).fill(false), second = new Array(l2).fill(false)
  let matches = 0
  for (let i = 0; i < l1; i++) for (let j = Math.max(0, i - distance); j < Math.min(i + distance + 1, l2); j++) {
    if (second[j] || s1[i] !== s2[j]) continue
    first[i] = second[j] = true; matches++; break
  }
  if (!matches) return 0
  let transpositions = 0, cursor = 0
  for (let i = 0; i < l1; i++) {
    if (!first[i]) continue
    while (!second[cursor]) cursor++
    if (s1[i] !== s2[cursor]) transpositions++
    cursor++
  }
  return (matches / l1 + matches / l2 + (matches - transpositions / 2) / matches) / 3
}

export function jaroWinkler(a: string, b: string): number {
  const similarity = jaro(a, b)
  let prefix = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) { if (a[i] === b[i]) prefix++; else break }
  return similarity + prefix * 0.1 * (1 - similarity)
}

export function computeFillableFields(contact: MatchableContact, person: MatchableExistingPerson): Record<string, string> {
  const result: Record<string, string> = {}
  // Offer the first identifier the person is genuinely missing — including a
  // secondary address, which is often the one worth adding.
  const knownEmails = new Set(person.emails.map(normalizeEmailForMatch).filter(Boolean))
  const newEmail = contactEmails(contact).find(email => {
    const key = normalizeEmailForMatch(email)
    return key ? !knownEmails.has(key) : false
  })
  if (newEmail) result.email = newEmail.trim()

  const knownPhones = new Set(person.phones.map(normalizePhoneForMatch).filter(Boolean))
  const newPhone = contactPhones(contact).find(phone => {
    const key = normalizePhoneForMatch(phone)
    return key ? !knownPhones.has(key) : false
  })
  if (newPhone) result.phone = newPhone.trim()
  const pairs: [keyof MatchableContact, keyof MatchableExistingPerson][] = [["title", "title"], ["company", "company"], ["headline", "headline"], ["birthday", "birthday"], ["location", "location"], ["linkedin", "linkedin"], ["twitter", "twitter"], ["website", "website"], ["facebook", "facebook"], ["instagram", "instagram"]]
  for (const [contactKey, personKey] of pairs) {
    const incoming = (contact[contactKey] as string | null | undefined)?.trim()
    const existing = (person[personKey] as string | null)?.trim()
    if (incoming && !existing) result[personKey as string] = incoming
  }
  const incomingNotes = contact.notes?.trim()
  const existingNotes = person.notes?.trim()
  if (incomingNotes && !existingNotes) result.notes = incomingNotes
  else if (incomingNotes && existingNotes && !existingNotes.includes(incomingNotes)) {
    result.notes = `${existingNotes}\n\n${incomingNotes}`
  }
  return result
}

export function findMatch(contact: MatchableContact, persons: MatchableExistingPerson[]): MatchResult | null {
  let best: { score: number; reason: string; person: MatchableExistingPerson } | null = null
  // A shared identifier anywhere in either record is a match — the primary
  // address is no more authoritative than a secondary one.
  const emails = contactEmails(contact)
  const phones = contactPhones(contact)
  for (const person of persons) {
    if (sharesAny(emails, person.emails, normalizeEmailForMatch)) { if (!best || best.score < 1) best = { score: 1, reason: "Same email address", person }; continue }
    if (sharesAny(phones, person.phones, normalizePhoneForMatch)) { if (!best || best.score < 0.97) best = { score: 0.97, reason: "Same phone number", person }; continue }
    const contactName = normalizeMatchText(`${contact.first ?? ""} ${contact.last ?? ""}`)
    const personName = normalizeMatchText(`${person.first} ${person.last}`)
    if (!contactName || !personName) continue
    const nameScore = jaroWinkler(contactName, personName)
    const sameCompany = Boolean(contact.company && person.company && jaroWinkler(normalizeMatchText(contact.company), normalizeMatchText(person.company)) > 0.85)
    let score = 0, reason = ""
    if (nameScore >= 0.92) { score = Math.min(1, nameScore + (sameCompany ? 0.03 : 0)); reason = sameCompany ? "Similar name, same company" : "Very similar name" }
    else if (nameScore >= 0.80 && sameCompany) { score = nameScore; reason = "Similar name, same company" }
    else if (nameScore >= POSSIBLE_THRESHOLD) { score = nameScore; reason = "Similar name" }
    if (score >= POSSIBLE_THRESHOLD && (!best || score > best.score)) best = { score, reason, person }
  }
  if (!best) return null
  const fillableFields = computeFillableFields(contact, best.person)
  return { personId: best.person.id, personName: `${best.person.first} ${best.person.last}`.trim(), personEmail: best.person.emails[0] ?? null, personCompany: best.person.company, score: best.score, reason: best.reason, fillableFields, fillableCount: Object.keys(fillableFields).length }
}
