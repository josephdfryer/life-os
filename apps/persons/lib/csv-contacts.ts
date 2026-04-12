import type { ParsedContact } from "./vcard"

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
  const getPrefix = (prefix: string) => colPrefix(header, row, prefix)

  const first = get("given name") || ""
  const last = get("family name") || ""
  const fn = get("name") || `${first} ${last}`.trim()
  const org = get("organization 1 - name") || get("organization name") || get("company") || null
  const title = get("organization 1 - title") || get("title") || get("job title") || null
  const email = colNumberedValue(header, row, "e-mail")
             || colNumberedValue(header, row, "email")
             || getPrefix("email address")
             || null
  const phone = colNumberedValue(header, row, "phone")
             || colNumberedValue(header, row, "mobile")
             || getPrefix("mobile phone")
             || null
  const birthday = parseBday(get("birthday"))
  const notes = get("notes") || null

  return {
    first: first || fn.split(" ")[0] || "",
    last: last || fn.split(" ").slice(1).join(" ") || "",
    fullName: fn,
    headline: title && org ? `${title} at ${org}` : title || org,
    company: org,
    email,
    phone,
    birthday,
    notes,
    location: null,
    linkedin: null,
    twitter: null,
    website: null,
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
    headline: position && company ? `${position} at ${company}` : position || company,
    company,
    email,
    phone: null,
    birthday: null,
    notes: null,
    location: null,
    linkedin: get("profile url") || null,
    twitter,
    website,
  }
}

// ─── Generic ──────────────────────────────────────────────────────────────────

function parseGenericRow(header: string[], row: string[]): ParsedContact {
  const get = (key: string) => col(header, row, key)
  const getPrefix = (prefix: string) => colPrefix(header, row, prefix)

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
  const email = getPrefix("email") || get("e-mail") || null
  const phone = getPrefix("phone") || getPrefix("mobile") || getPrefix("cell") || null
  const birthday = parseBday(get("birthday") || get("date of birth") || get("dob"))
  const notes = get("notes") || get("note") || get("description") || null
  const location = get("city") || get("location") || get("address") || null
  const linkedin = get("linkedin") || get("linkedin url") || null
  const twitter = get("twitter") || null
  const website = get("website") || get("url") || null

  return {
    first,
    last,
    fullName,
    headline: title && org ? `${title} at ${org}` : title || org,
    company: org,
    email,
    phone,
    birthday,
    notes,
    location,
    linkedin,
    twitter,
    website,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function col(header: string[], row: string[], key: string): string | null {
  const idx = header.findIndex(h => h.toLowerCase().trim() === key.toLowerCase())
  if (idx === -1) return null
  return row[idx]?.trim() || null
}

function colPrefix(header: string[], row: string[], prefix: string): string | null {
  const idx = header.findIndex(h => h.toLowerCase().trim().startsWith(prefix.toLowerCase()))
  if (idx === -1) return null
  return row[idx]?.trim() || null
}

/**
 * For Google-style "Field N - Type / Field N - Value" column pairs.
 * Scans up to 10 numbered slots and returns the first non-empty Value.
 * e.g. colNumberedValue(h, r, "e-mail") finds "E-mail 1 - Value", "E-mail 2 - Value", …
 */
function colNumberedValue(header: string[], row: string[], prefix: string): string | null {
  const p = prefix.toLowerCase()
  for (let n = 1; n <= 10; n++) {
    const key = `${p} ${n} - value`
    const idx = header.findIndex(h => h.toLowerCase().trim() === key)
    if (idx !== -1 && row[idx]?.trim()) return row[idx].trim()
  }
  return null
}

function parseBday(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m1 = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m1) return raw
  const m2 = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m2) return `${m2[3]}-${m2[1].padStart(2,"0")}-${m2[2].padStart(2,"0")}`
  const m3 = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`
  return null
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
