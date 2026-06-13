import { normalizeBirthday } from "./birthday"

export type ParsedContact = {
  first: string
  last: string
  fullName: string
  title: string | null
  headline: string | null
  company: string | null
  email: string | null
  phone: string | null
  birthday: string | null
  notes: string | null
  location: string | null
  linkedin: string | null
  twitter: string | null
  website: string | null
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

function parseOneVCard(card: string): ParsedContact {
  // Unfold continuation lines (RFC 6350 §3.2)
  const unfolded = card.replace(/\r?\n[ \t]/g, "")
  const lines = unfolded.split(/\r?\n/).filter(Boolean)

  const get = (key: RegExp | string): string | null => {
    for (const line of lines) {
      const match = typeof key === "string"
        ? line.match(new RegExp(`^${key}[;:](.*)$`, "i"))
        : line.match(key)
      if (match) return decodeValue(match[1].trim())
    }
    return null
  }

  const getAll = (key: RegExp | string): string[] => {
    const results: string[] = []
    for (const line of lines) {
      const match = typeof key === "string"
        ? line.match(new RegExp(`^${key}[;:](.*)$`, "i"))
        : line.match(key)
      if (match) results.push(decodeValue(match[1].trim()))
    }
    return results
  }

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
  const org = get(/^ORG[;:](.*)/i)?.split(";")[0].trim() ?? null
  const title = get(/^TITLE[;:](.*)/i)
  const company = org
  let headline: string | null = null
  if (title && org) headline = `${title} at ${org}`
  else if (title) headline = title
  else if (org) headline = org

  // Email — prefer pref or first found
  const emails = getAll(/^EMAIL[;:](.*)/i)
  const email = emails[0] ?? null

  // Phone — prefer CELL or first found
  const phones = lines
    .filter(l => /^TEL[;:]/i.test(l))
    .map(l => {
      const val = l.replace(/^TEL[^:]*:/i, "").trim()
      return { val, isCell: /CELL|MOBILE/i.test(l) }
    })
  const phone =
    phones.find(p => p.isCell)?.val ??
    phones[0]?.val ??
    null

  // Birthday
  const bdayRaw = get(/^BDAY[;:](.*)/i)
  const birthday = normalizeBirthday(bdayRaw)

  // Notes
  const notes = get(/^NOTE[;:](.*)/i)?.replace(/\\n/g, "\n").trim() ?? null

  // Address → location (structured ADR: POBox;Ext;Street;City;State;Zip;Country)
  const adrRaw = get(/^ADR[;:](.*)/i)
  let location: string | null = null
  if (adrRaw) {
    const parts = adrRaw.split(";").map(p => p.trim()).filter(Boolean)
    // Skip PO Box and extended address (first two), take street, city, state, country
    const meaningful = parts.slice(2).filter(Boolean)
    if (meaningful.length) location = meaningful.join(", ")
  }

  // URLs — sniff for LinkedIn/Twitter, else website
  const urls = getAll(/^URL[;:](.*)/i)
  let linkedin: string | null = null
  let twitter: string | null = null
  let website: string | null = null
  for (const url of urls) {
    const lower = url.toLowerCase()
    if (lower.includes("linkedin.com")) linkedin = url
    else if (lower.includes("twitter.com") || lower.includes("x.com")) twitter = url
    else if (!website) website = url
  }

  return {
    first: first || fn.split(" ")[0] || "",
    last: last || fn.split(" ").slice(1).join(" ") || "",
    fullName: fn || `${first} ${last}`.trim(),
    title,
    headline,
    company,
    email,
    phone: phone ? normalizePhone(phone) : null,
    birthday,
    notes: notes || null,
    location,
    linkedin,
    twitter,
    website,
  }
}

function decodeValue(val: string): string {
  // Handle quoted-printable encoded values
  if (val.includes("=")) {
    // Basic QP decode for common UTF-8 sequences
    try {
      return val.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
    } catch {
      // ignore
    }
  }
  // Unescape vCard backslash sequences
  return val.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, "\n").replace(/\\\\/g, "\\")
}

function normalizePhone(phone: string): string {
  // Remove common noise, keep digits + + - () spaces
  return phone.replace(/[^\d\s+\-().]/g, "").trim()
}
