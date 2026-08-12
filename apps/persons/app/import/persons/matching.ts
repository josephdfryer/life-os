import type { ParsedContact } from "@/lib/vcard"
import { normalizeEmailForMatch, normalizePhoneForMatch, sharesAny } from "@/lib/contact-values"
import type { Person } from "@/types"

export const DUPLICATE_THRESHOLD = 0.85
export const POSSIBLE_THRESHOLD = 0.70

export type MatchResult = { personId: string; personName: string; personEmail: string | null; personCompany: string | null; score: number; reason: string; fillableFields: Record<string, string>; fillableCount: number }
export type ContactAction = "import" | "update_existing" | "import_new" | "skip"
export type ReviewContact = ParsedContact & { closeness: number; tags: string; skip: boolean; colorIdx: number; guessedName: boolean; guessedFrom: string | null; needsReview: boolean; matchResult: MatchResult | null; action: ContactAction; selected: boolean }
export type ContactStatus = "ready" | "review" | "error" | "duplicate" | "possible"
export type QualityStats = { total: number; needsReview: number; guessedName: number; noEmail: number; noPhone: number; noCompany: number; duplicates: number; possibles: number }

export function normalizeMatchText(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "") }

// Identifier normalization lives in lib/contact-values so importers, matching,
// and dedupe all compare on exactly the same keys.
export { normalizeEmailForMatch, normalizePhoneForMatch } from "@/lib/contact-values"

/**
 * A contact's identifiers, tolerating the pre-multi-value shape. These objects
 * cross a network boundary (the import preview API), so a payload carrying only
 * the primary must still match rather than silently scoring zero.
 */
function contactEmails(contact: ParsedContact): string[] {
  return contact.emails?.length ? contact.emails : (contact.email ? [contact.email] : [])
}
function contactPhones(contact: ParsedContact): string[] {
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

export function computeFillableFields(contact: ParsedContact, person: Person): Record<string, string> {
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
  const pairs: [keyof ParsedContact, keyof Person][] = [["title", "title"], ["company", "company"], ["headline", "headline"], ["birthday", "birthday"], ["location", "location"], ["linkedin", "linkedin"], ["twitter", "twitter"], ["website", "website"], ["facebook", "facebook"], ["instagram", "instagram"]]
  for (const [contactKey, personKey] of pairs) {
    const incoming = (contact[contactKey] as string | null)?.trim()
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

export function findMatch(contact: ParsedContact, persons: Person[]): MatchResult | null {
  let best: { score: number; reason: string; person: Person } | null = null
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

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
export function guessNameFromEmail(email: string): { first: string; last: string } | null {
  const local = email.split("@")[0]
  if (!local) return null
  const cleaned = local.replace(/\d+$/, "").replace(/^[._-]+|[._-]+$/g, "")
  if (cleaned.length < 2) return null
  for (const separator of [".", "_", "-"]) {
    const parts = cleaned.split(separator).filter(part => part.length >= 2)
    if (parts.length >= 2) return { first: capitalize(parts[0]), last: capitalize(parts.at(-1)!) }
  }
  return { first: capitalize(cleaned), last: "" }
}

export function getStatus(contact: ReviewContact): ContactStatus {
  if (contact.matchResult) return contact.matchResult.score >= DUPLICATE_THRESHOLD ? "duplicate" : "possible"
  if (!contact.first?.trim() && !contact.email) return "error"
  if (contact.guessedName || !contact.email) return "review"
  return "ready"
}
export function sortByStatus(contacts: ReviewContact[]): ReviewContact[] {
  const rank = (contact: ReviewContact) => contact.skip ? 5 : ({ duplicate: 0, possible: 1, error: 2, review: 3, ready: 4 } as const)[getStatus(contact)]
  return [...contacts].sort((a, b) => rank(a) - rank(b))
}
export function computeStats(contacts: ReviewContact[]): QualityStats {
  return { total: contacts.length, needsReview: contacts.filter(value => value.needsReview).length, guessedName: contacts.filter(value => value.guessedName).length, noEmail: contacts.filter(value => !value.email).length, noPhone: contacts.filter(value => !value.phone).length, noCompany: contacts.filter(value => !value.company).length, duplicates: contacts.filter(value => !value.skip && value.matchResult !== null && value.matchResult.score >= DUPLICATE_THRESHOLD).length, possibles: contacts.filter(value => !value.skip && value.matchResult !== null && value.matchResult.score < DUPLICATE_THRESHOLD).length }
}
