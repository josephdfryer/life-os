import { contactIdentifiers, type ParsedContact } from "./vcard"
import { normalizeBirthday } from "./birthday"

export type CsvFlavor = "google" | "linkedin" | "generic" | "unknown"

/**
 * Sniff the CSV flavor from the header row.
 */
export function detectCsvFlavor(header: string[]): CsvFlavor {
  const h = header.map(c => c.toLowerCase().trim())
  if (h.includes("given name") || h.includes("family name") || h.some(c => c.startsWith("email 1")))
    return "google"
  if (h.includes("first name") && h.includes("last name") && h.includes("connected on"))
    return "linkedin"
  if (
    (h.includes("name") || (h.includes("first name") && h.includes("last name"))) &&
    (h.some(c => c.includes("email")) || h.some(c => c.includes("phone")))
  )
    return "generic"
  return "unknown"
}

/**
 * Parse a CSV string into contacts. Returns null if not a contacts CSV.
 */
export function parseCsvContacts(raw: string): ParsedContact[] | null {
  const rows = parseCSV(raw)
  if (rows.length < 2) return null

  const header = rows[0]
  const flavor = detectCsvFlavor(header)
  if (flavor === "unknown") return null

  const data = rows.slice(1).filter(r => r.some(c => c.trim()))

  if (flavor === "google") return data.map(r => parseGoogleRow(header, r)).filter(c => c.first || c.last)
  if (flavor === "linkedin") return data.map(r => parseLinkedInRow(header, r)).filter(c => c.first || c.last)
  return data.map(r => parseGenericRow(header, r)).filter(c => c.first || c.last)
}

// ─── Google Contacts ──────────────────────────────────────────────────────────

function parseGoogleRow(header: string[], row: string[]): ParsedContact {
  const get = (key: string) => col(header, row, key)

  const first = get("given name") || ""
  const last = get("family name") || ""
  const fn = get("name") || `${first} ${last}`.trim()
  const org = get("organization 1 - name") || get("organization name") || get("company") || null
  const title = get("organization 1 - title") || get("title") || get("job title") || null
  const identifiers = contactIdentifiers(
    [
      ...colNumberedValues(header, row, "e-mail"),
      ...colNumberedValues(header, row, "email"),
      ...colPrefixAll(header, row, "email address"),
    ],
    [
      ...colNumberedValues(header, row, "phone"),
      ...colNumberedValues(header, row, "mobile"),
      ...colPrefixAll(header, row, "mobile phone"),
    ],
  )
  const birthday = normalizeBirthday(get("birthday"))
  const notes = get("notes") || null

  return {
    first: first || fn.split(" ")[0] || "",
    last: last || fn.split(" ").slice(1).join(" ") || "",
    fullName: fn,
    title,
    headline: title && org ? `${title} at ${org}` : title || org,
    company: org,
    ...identifiers,
    birthday,
    notes,
    location: null,
    linkedin: null,
    twitter: null,
    website: null,
    facebook: null,
    instagram: null,
  }
}

// ─── LinkedIn ─────────────────────────────────────────────────────────────────

function parseLinkedInRow(header: string[], row: string[]): ParsedContact {
  const get = (key: string) => col(header, row, key)

  const first = get("first name") || ""
  const last = get("last name") || ""
  const company = get("company") || null
  const position = get("position") || null
  const email = get("email address") || null
  const twitter = get("twitter") || null
  const website = get("website") || null

  return {
    first,
    last,
    fullName: `${first} ${last}`.trim(),
    title: position,
    headline: position && company ? `${position} at ${company}` : position || company,
    company,
    ...contactIdentifiers([email], []),
    birthday: null,
    notes: null,
    location: null,
    linkedin: get("profile url") || null,
    twitter,
    website,
    facebook: null,
    instagram: null,
  }
}

// ─── Generic ──────────────────────────────────────────────────────────────────

function parseGenericRow(header: string[], row: string[]): ParsedContact {
  const get = (key: string) => col(header, row, key)

  let first = get("first name") || get("first") || ""
  let last = get("last name") || get("last") || get("surname") || ""
  const fullName = get("name") || get("full name") || `${first} ${last}`.trim()

  if (!first && !last && fullName) {
    const parts = fullName.split(" ")
    first = parts[0] || ""
    last = parts.slice(1).join(" ") || ""
  }

  const org = get("company") || get("organization") || get("employer") || null
  const title = get("title") || get("job title") || get("position") || get("role") || null
  const identifiers = contactIdentifiers(
    [...colPrefixAll(header, row, "email"), ...splitMultiValue(get("e-mail"))],
    [
      ...colPrefixAll(header, row, "phone"),
      ...colPrefixAll(header, row, "mobile"),
      ...colPrefixAll(header, row, "cell"),
    ],
  )
  const birthday = normalizeBirthday(get("birthday") || get("date of birth") || get("dob"))
  const notes = get("notes") || get("note") || get("description") || null
  const location = get("city") || get("location") || get("address") || null
  const linkedin = get("linkedin") || get("linkedin url") || null
  const twitter = get("twitter") || null
  const website = get("website") || get("url") || null
  const facebook = get("facebook") || get("facebook url") || null
  const instagram = get("instagram") || null

  return {
    first,
    last,
    fullName,
    title,
    headline: title && org ? `${title} at ${org}` : title || org,
    company: org,
    ...identifiers,
    birthday,
    notes,
    location,
    linkedin,
    twitter,
    website,
    facebook,
    instagram,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function col(header: string[], row: string[], key: string): string | null {
  const idx = header.findIndex(h => h.toLowerCase().trim() === key.toLowerCase())
  if (idx === -1) return null
  return row[idx]?.trim() || null
}

/**
 * Google packs repeated values into a single cell separated by " ::: ".
 * Splitting it is the difference between one usable address and three.
 */
function splitMultiValue(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split(/\s*:::\s*/).map(part => part.trim()).filter(Boolean)
}

/**
 * For Google-style "Field N - Type / Field N - Value" column pairs.
 * Returns every non-empty Value across all numbered slots, in order.
 * e.g. colNumberedValues(h, r, "e-mail") finds "E-mail 1 - Value", "E-mail 2 - Value", …
 */
function colNumberedValues(header: string[], row: string[], prefix: string): string[] {
  const p = prefix.toLowerCase()
  const values: string[] = []
  for (let n = 1; n <= 10; n++) {
    const key = `${p} ${n} - value`
    const idx = header.findIndex(h => h.toLowerCase().trim() === key)
    if (idx !== -1) values.push(...splitMultiValue(row[idx]))
  }
  return values
}

/** Every column whose header starts with `prefix`, not just the first. */
function colPrefixAll(header: string[], row: string[], prefix: string): string[] {
  const p = prefix.toLowerCase()
  const values: string[] = []
  header.forEach((name, idx) => {
    if (name.toLowerCase().trim().startsWith(p)) values.push(...splitMultiValue(row[idx]))
  })
  return values
}

/**
 * Minimal RFC-4180 CSV parser. Handles quoted fields and embedded commas/newlines.
 * Exported so the API route can access raw rows for Claude mapping.
 */
export function parseCSVRows(raw: string): string[][] {
  return parseCSV(raw)
}

function parseCSV(raw: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  const s = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ",") {
        row.push(field); field = ""
      } else if (ch === "\n") {
        row.push(field); field = ""
        rows.push(row); row = []
      } else {
        field += ch
      }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.length > 0)
}
