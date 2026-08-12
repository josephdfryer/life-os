import { normalizeBirthday } from "./birthday"
import { dedupeEmails, dedupePhones } from "./contact-values"

export type ParsedContact = {
  first: string
  last: string
  fullName: string
  title: string | null
  headline: string | null
  company: string | null
  /** Primary email — always `emails[0]` when the source had any. */
  email: string | null
  /** Primary phone — always `phones[0]` when the source had any. */
  phone: string | null
  /**
   * Every email the source knew about, deduped, primary first. Secondary
   * addresses are the strongest dedupe signal available, so they must survive
   * import rather than being dropped at the parser.
   */
  emails: string[]
  /** Every phone the source knew about, deduped, primary first. */
  phones: string[]
  birthday: string | null
  notes: string | null
  location: string | null
  linkedin: string | null
  twitter: string | null
  website: string | null
  facebook: string | null
  instagram: string | null
  /**
   * Stable identifier from the originating source (Google `resourceName`,
   * CNContact identifier, …) so a re-sync converges onto the same record
   * instead of creating a duplicate.
   */
  sourceId?: string | null
  /** Source-side version marker, where the provider offers one (Google `etag`). */
  sourceEtag?: string | null
  /** User-curated grouping from the source (Google contact groups / labels). */
  groups?: string[]
}

/**
 * Build the email/phone fields of a ParsedContact from raw source values.
 * Ordering is preserved, so callers should pass their preferred value first.
 */
export function contactIdentifiers(
  rawEmails: (string | null | undefined)[],
  rawPhones: (string | null | undefined)[],
): Pick<ParsedContact, "email" | "phone" | "emails" | "phones"> {
  const emails = dedupeEmails(rawEmails)
  const phones = dedupePhones(rawPhones)
  return { email: emails[0] ?? null, phone: phones[0] ?? null, emails, phones }
}

/**
 * Parse one or more vCards from a .vcf file string.
 * Handles vCard 2.1, 3.0, and 4.0.
 */
export function parseVCards(raw: string): ParsedContact[] {
  const cards = raw
    .split(/BEGIN:VCARD/i)
    .slice(1) // discard leading empty
    .map(chunk => "BEGIN:VCARD\n" + chunk.split(/END:VCARD/i)[0])

  return cards.map(parseOneVCard).filter(c => c.first || c.last || c.fullName)
}

type ContentLine = { name: string; params: string; value: string }

/**
 * Split one vCard content line into property name, parameters, and value.
 *
 * Two details matter and were previously mishandled:
 *  - Parameters sit between the name and the *first unquoted* colon
 *    (`EMAIL;TYPE=WORK:a@b.com`), so a naive split leaks `TYPE=WORK:` into the
 *    value. That corrupted every typed email and address on import.
 *  - Apple's exports prefix properties with a group (`item1.EMAIL:…`), which
 *    has to be stripped or the property never matches by name.
 */
function parseContentLine(line: string): ContentLine | null {
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') { inQuotes = !inQuotes; continue }
    if (char !== ":" || inQuotes) continue

    const head = line.slice(0, i)
    const semi = head.indexOf(";")
    let name = (semi === -1 ? head : head.slice(0, semi)).trim().toUpperCase()
    const group = name.lastIndexOf(".")
    if (group !== -1) name = name.slice(group + 1)

    const params = semi === -1 ? "" : head.slice(semi + 1)
    return { name, params, value: decodeValue(line.slice(i + 1).trim(), params) }
  }
  return null
}

function parseOneVCard(card: string): ParsedContact {
  // Unfold continuation lines (RFC 6350 §3.2)
  const unfolded = card.replace(/\r?\n[ \t]/g, "")
  const lines = unfolded.split(/\r?\n/).filter(Boolean)

  const entries = lines
    .map(parseContentLine)
    .filter((entry): entry is ContentLine => entry !== null)

  const all = (name: string): ContentLine[] => entries.filter(entry => entry.name === name)
  const get = (name: string): string | null => {
    const value = all(name)[0]?.value?.trim()
    return value ? value : null
  }
  const getAll = (name: string): string[] =>
    all(name).map(entry => entry.value.trim()).filter(Boolean)

  // Structured name: N:Last;First;Middle;Prefix;Suffix
  const nRaw = get("N")
  let first = ""
  let last = ""
  if (nRaw) {
    const parts = nRaw.split(";")
    last = parts[0]?.trim() ?? ""
    first = parts[1]?.trim() ?? ""
  }

  // Full name fallback
  const fn = get("FN") ?? ""
  if (!first && !last && fn) {
    const parts = fn.split(" ")
    first = parts[0] ?? ""
    last = parts.slice(1).join(" ")
  }

  // Org + Title
  const org = get("ORG")?.split(";")[0].trim() || null
  const title = get("TITLE")
  const company = org
  let headline: string | null = null
  if (title && org) headline = `${title} at ${org}`
  else if (title) headline = title
  else if (org) headline = org

  // Every address and number is kept. Preferred/mobile entries sort first so
  // they become the primary, but the rest survive as match keys.
  const emailEntries = all("EMAIL")
  const isPreferred = (entry: ContentLine) => /\bPREF\b/i.test(entry.params)
  const rawEmails = [
    ...emailEntries.filter(isPreferred),
    ...emailEntries.filter(entry => !isPreferred(entry)),
  ].map(entry => entry.value)

  const telEntries = all("TEL")
  const isMobile = (entry: ContentLine) => /CELL|MOBILE|IPHONE/i.test(entry.params)
  const rawPhones = [
    ...telEntries.filter(isMobile),
    ...telEntries.filter(entry => !isMobile(entry)),
  ].map(entry => normalizePhone(entry.value))

  const identifiers = contactIdentifiers(rawEmails, rawPhones)

  // Birthday
  const birthday = normalizeBirthday(get("BDAY"))

  // Notes
  const notes = get("NOTE")

  // Address → location (structured ADR: POBox;Ext;Street;City;State;Zip;Country)
  const adrRaw = get("ADR")
  let location: string | null = null
  if (adrRaw) {
    const parts = adrRaw.split(";").map(p => p.trim()).filter(Boolean)
    // Skip PO Box and extended address (first two), take street, city, state, country
    const meaningful = parts.slice(2).filter(Boolean)
    if (meaningful.length) location = meaningful.join(", ")
  }

  // URLs — sniff for LinkedIn/Twitter/Facebook/Instagram, else website
  const urls = getAll("URL")
  let linkedin: string | null = null
  let twitter: string | null = null
  let website: string | null = null
  let facebook: string | null = null
  let instagram: string | null = null
  for (const url of urls) {
    const lower = url.toLowerCase()
    if (lower.includes("linkedin.com")) linkedin = url
    else if (lower.includes("twitter.com") || lower.includes("x.com")) twitter = url
    else if (lower.includes("facebook.com") || lower.includes("fb.com")) facebook = url
    else if (lower.includes("instagram.com")) instagram = url
    else if (!website) website = url
  }

  return {
    first: first || fn.split(" ")[0] || "",
    last: last || fn.split(" ").slice(1).join(" ") || "",
    fullName: fn || `${first} ${last}`.trim(),
    title,
    headline,
    company,
    ...identifiers,
    birthday,
    notes: notes || null,
    location,
    linkedin,
    twitter,
    website,
    facebook,
    instagram,
  }
}

/**
 * Decode a content-line value.
 *
 * Quoted-printable decoding is driven by the line's own ENCODING parameter.
 * It used to run on any value containing "=", which silently mangled ordinary
 * data — a URL like `https://x.com/?ref=1b` had `=1b` swallowed as an escape.
 */
function decodeValue(val: string, params = ""): string {
  let result = val
  if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) {
    try {
      const bytes: number[] = []
      for (let i = 0; i < result.length; i++) {
        if (result[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(result.slice(i + 1, i + 3))) {
          bytes.push(parseInt(result.slice(i + 1, i + 3), 16))
          i += 2
        } else {
          bytes.push(result.charCodeAt(i))
        }
      }
      result = new TextDecoder("utf-8").decode(Uint8Array.from(bytes))
    } catch {
      // Fall through with the raw value rather than losing the contact.
    }
  }
  // Unescape vCard backslash sequences
  return result.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, "\n").replace(/\\\\/g, "\\")
}

function normalizePhone(phone: string): string {
  // Remove common noise, keep digits + + - () spaces
  return phone.replace(/[^\d\s+\-().]/g, "").trim()
}
