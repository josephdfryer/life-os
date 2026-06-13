/**
 * Life OS Contact Standard v1
 * ─────────────────────────────────────────────────────────────────────────────
 * All contact imports are normalized to this shape before entering the system.
 * Any source format (Google CSV, LinkedIn, Salesforce, vCard, etc.) is mapped
 * here by Claude before parsing so downstream code only ever sees one schema.
 *
 * Fields:
 *   first    — First / given name
 *   last     — Last / family name
 *   email    — Primary email address
 *   phone    — Primary phone number (any format, stored as-is)
 *   company  — Employer or organization name
 *   title    — Job title or role
 *   birthday — Date of birth in YYYY-MM-DD (or YYYY-MM if day unknown)
 *   notes    — Free-form notes or bio
 *   location — City and/or country
 *   linkedin — LinkedIn profile URL or /in/handle
 *   twitter  — Twitter/X @handle
 *   website  — Personal or professional website URL
 */

import Anthropic from "@anthropic-ai/sdk"
import type { ParsedContact } from "./vcard"
import { normalizeBirthday } from "./birthday"

// ── Types ────────────────────────────────────────────────────────────────────

export type ColumnMapping = {
  first:    string | null
  last:     string | null
  email:    string | null
  phone:    string | null
  company:  string | null
  title:    string | null
  birthday: string | null
  notes:    string | null
  location: string | null
  linkedin: string | null
  twitter:  string | null
  website:  string | null
}

// ── Claude mapping detection ─────────────────────────────────────────────────

const FIELD_DESCRIPTIONS: Record<keyof ColumnMapping, string> = {
  first:    "First / given name",
  last:     "Last / family / surname",
  email:    "Primary email address — prefer '- Value' columns over '- Type'",
  phone:    "Primary phone number — prefer '- Value' columns over '- Type'",
  company:  "Employer, organization, or company name",
  title:    "Job title, role, or position",
  birthday: "Date of birth (any format — will be normalized)",
  notes:    "Free-form notes, bio, or description",
  location: "City, region, or country",
  linkedin: "LinkedIn profile URL or handle",
  twitter:  "Twitter or X handle",
  website:  "Personal or professional website URL",
}

export async function detectColumnMapping(
  headerRow: string[],
  sampleRows: string[][],
): Promise<ColumnMapping> {
  const client = new Anthropic()

  const fieldList = Object.entries(FIELD_DESCRIPTIONS)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n")

  const headerStr = headerRow.join(", ")
  const sampleStr = sampleRows
    .slice(0, 5)
    .map(r => r.map((v, i) => `${headerRow[i]}: ${v}`).join(" | "))
    .join("\n")

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `You are mapping columns from a contacts CSV export to the Life OS Contact Standard.

Standard fields and what they mean:
${fieldList}

CSV columns available:
${headerStr}

Sample rows (column: value format):
${sampleStr}

Return ONLY a valid JSON object mapping each standard field name to the exact CSV column header string it should be read from, or null if no suitable column exists.
Important: for "Type / Value" column pairs (like "E-mail 1 - Type" and "E-mail 1 - Value"), always map to the Value column.
No explanation, no markdown fences, just the raw JSON object.`,
      },
    ],
  })

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : ""
  // Strip markdown fences if model adds them despite instructions
  const clean = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim()
  const parsed = JSON.parse(clean) as ColumnMapping
  return parsed
}

// ── Mapping application ───────────────────────────────────────────────────────

export function applyMapping(
  header: string[],
  rows: string[][],
  mapping: ColumnMapping,
): ParsedContact[] {
  function get(row: string[], colName: string | null): string | null {
    if (!colName) return null
    const idx = header.findIndex(h => h.trim() === colName.trim())
    if (idx === -1) return null
    return row[idx]?.trim() || null
  }

  return rows
    .map(row => {
      const first   = get(row, mapping.first)   ?? ""
      const last    = get(row, mapping.last)    ?? ""
      const title   = get(row, mapping.title)
      const company = get(row, mapping.company)

      return {
        first,
        last,
        fullName:  `${first} ${last}`.trim(),
        title,
        headline:  title && company ? `${title} at ${company}` : title ?? company ?? null,
        company,
        email:     get(row, mapping.email),
        phone:     get(row, mapping.phone),
        birthday:  normalizeBirthday(get(row, mapping.birthday)),
        notes:     get(row, mapping.notes),
        location:  get(row, mapping.location),
        linkedin:  get(row, mapping.linkedin),
        twitter:   get(row, mapping.twitter),
        website:   get(row, mapping.website),
      }
    })
    .filter(c => c.first || c.last || c.email)
}
