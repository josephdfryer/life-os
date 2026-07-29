import ExcelJS from "exceljs"
import { normalizeBirthday } from "./birthday"
import type { ParsedContact } from "./vcard"

const MAX_ROWS_PER_SHEET = 5_000
const MAX_COLUMNS = 100

type ContactField =
  | "fullName" | "first" | "last" | "email" | "phone" | "company" | "title"
  | "birthday" | "notes" | "location" | "linkedin" | "twitter" | "website"
  | "facebook" | "instagram"

export type SpreadsheetImportSummary = {
  filename: string
  sheetsScanned: number
  peopleTables: Array<{ sheet: string; headerRow: number; people: number }>
  ignoredSheets: string[]
}

export type SpreadsheetImportResult = {
  contacts: ParsedContact[]
  summary: SpreadsheetImportSummary
}

const ALIASES: Record<ContactField, string[]> = {
  fullName: ["name", "full name", "contact name", "person", "guest", "attendee", "participant"],
  first: ["first", "first name", "given name", "given"],
  last: ["last", "last name", "surname", "family name", "family"],
  email: ["email", "email address", "e mail", "primary email"],
  phone: ["phone", "phone number", "mobile", "mobile number", "cell", "cell phone", "telephone"],
  company: ["company", "organization", "organisation", "employer"],
  title: ["title", "job title", "role", "position"],
  birthday: ["birthday", "birth date", "date of birth", "dob"],
  notes: ["notes", "note", "bio", "description"],
  location: ["location", "city", "home city", "address"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile"],
  twitter: ["twitter", "x", "twitter handle", "x handle"],
  website: ["website", "web site", "url", "personal website"],
  facebook: ["facebook", "facebook url", "facebook profile"],
  instagram: ["instagram", "instagram handle", "instagram profile"],
}

const ALIAS_LOOKUP = new Map(
  Object.entries(ALIASES).flatMap(([field, aliases]) =>
    aliases.map(alias => [normalizeHeader(alias), field as ContactField] as const)
  )
)

export async function parseSpreadsheetContacts(
  buffer: Buffer,
  filename = "spreadsheet.xlsx",
): Promise<SpreadsheetImportResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])

  const contacts: ParsedContact[] = []
  const peopleTables: SpreadsheetImportSummary["peopleTables"] = []
  const usedSheets = new Set<string>()

  for (const sheet of workbook.worksheets) {
    const table = findPeopleTable(sheet)
    if (!table) continue

    const parsed = parsePeopleTable(sheet, table.headerRow, table.fields, filename)
    if (!parsed.length) continue
    contacts.push(...parsed)
    peopleTables.push({ sheet: sheet.name, headerRow: table.headerRow, people: parsed.length })
    usedSheets.add(sheet.name)
  }

  return {
    contacts: mergeExactDuplicates(contacts),
    summary: {
      filename,
      sheetsScanned: workbook.worksheets.length,
      peopleTables,
      ignoredSheets: workbook.worksheets.map(sheet => sheet.name).filter(name => !usedSheets.has(name)),
    },
  }
}

function findPeopleTable(sheet: ExcelJS.Worksheet): {
  headerRow: number
  fields: Map<number, ContactField>
} | null {
  let best: { headerRow: number; fields: Map<number, ContactField>; score: number } | null = null
  const rowLimit = Math.min(sheet.rowCount, MAX_ROWS_PER_SHEET)

  for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber++) {
    const row = sheet.getRow(rowNumber)
    const fields = new Map<number, ContactField>()
    const columnLimit = Math.min(row.cellCount, MAX_COLUMNS)
    for (let column = 1; column <= columnLimit; column++) {
      const field = ALIAS_LOOKUP.get(normalizeHeader(cellText(row.getCell(column))))
      if (field && !Array.from(fields.values()).includes(field)) fields.set(column, field)
    }

    const values = new Set(fields.values())
    const hasName = values.has("fullName") || values.has("first") || values.has("last")
    if (!hasName) continue
    const score =
      (values.has("fullName") ? 5 : 0) +
      (values.has("first") ? 3 : 0) +
      (values.has("last") ? 2 : 0) +
      (values.has("email") ? 3 : 0) +
      (values.has("phone") ? 3 : 0) +
      Math.max(0, values.size - 1)
    if (score < 5 || !hasPersonDataBelow(sheet, rowNumber, fields)) continue
    if (!best || score > best.score) best = { headerRow: rowNumber, fields, score }
  }

  return best
}

function hasPersonDataBelow(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  fields: Map<number, ContactField>,
): boolean {
  const nameColumns = Array.from(fields).filter(([, field]) =>
    field === "fullName" || field === "first" || field === "last"
  ).map(([column]) => column)
  for (let rowNumber = headerRow + 1; rowNumber <= Math.min(headerRow + 12, sheet.rowCount); rowNumber++) {
    if (nameColumns.some(column => cellText(sheet.getRow(rowNumber).getCell(column)).trim())) return true
  }
  return false
}

function parsePeopleTable(
  sheet: ExcelJS.Worksheet,
  headerRowNumber: number,
  fields: Map<number, ContactField>,
  filename: string,
): ParsedContact[] {
  const headerRow = sheet.getRow(headerRowNumber)
  const headers = new Map<number, string>()
  const columnLimit = Math.min(Math.max(headerRow.cellCount, sheet.columnCount), MAX_COLUMNS)
  for (let column = 1; column <= columnLimit; column++) {
    const label = cellText(headerRow.getCell(column)).trim()
    if (label) headers.set(column, label)
  }

  const context = collectSheetContext(sheet, headerRowNumber)
  const contacts: ParsedContact[] = []
  let blankNameRows = 0

  for (
    let rowNumber = headerRowNumber + 1;
    rowNumber <= Math.min(sheet.rowCount, MAX_ROWS_PER_SHEET);
    rowNumber++
  ) {
    const row = sheet.getRow(rowNumber)
    const values = new Map<number, string>()
    for (const column of headers.keys()) {
      const value = cellText(row.getCell(column)).trim()
      if (value) values.set(column, value)
    }

    const fieldValue = (field: ContactField) => {
      const entry = Array.from(fields).find(([, mapped]) => mapped === field)
      return entry ? values.get(entry[0]) ?? "" : ""
    }
    const fullName = fieldValue("fullName")
    let first = fieldValue("first")
    let last = fieldValue("last")
    if (!first && !last && fullName) ({ first, last } = splitName(fullName))

    if (!first && !last) {
      blankNameRows++
      if (blankNameRows >= 2 && contacts.length) break
      continue
    }
    blankNameRows = 0

    const details = Array.from(headers)
      .filter(([column]) => values.has(column) && !fields.has(column))
      .map(([column, label]) => `- ${label}: ${values.get(column)}`)
    const importedNotes = fieldValue("notes")
    const noteSections = [
      `Imported from ${filename}`,
      `Sheet: ${sheet.name}`,
      context.length ? `Context:\n${context.map(value => `- ${value}`).join("\n")}` : "",
      details.length ? `Spreadsheet details:\n${details.join("\n")}` : "",
      importedNotes ? `Original notes:\n${importedNotes}` : "",
    ].filter(Boolean)

    const title = fieldValue("title") || null
    const company = fieldValue("company") || null
    contacts.push({
      first,
      last,
      fullName: fullName || `${first} ${last}`.trim(),
      title,
      headline: title && company ? `${title} at ${company}` : title || company,
      company,
      email: fieldValue("email") || null,
      phone: fieldValue("phone") || null,
      birthday: normalizeBirthday(fieldValue("birthday") || null),
      notes: noteSections.join("\n\n"),
      location: fieldValue("location") || null,
      linkedin: fieldValue("linkedin") || null,
      twitter: fieldValue("twitter") || null,
      website: fieldValue("website") || null,
      facebook: fieldValue("facebook") || null,
      instagram: fieldValue("instagram") || null,
    })
  }
  return contacts
}

function collectSheetContext(sheet: ExcelJS.Worksheet, headerRow: number): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (let rowNumber = 1; rowNumber < headerRow; rowNumber++) {
    const row = sheet.getRow(rowNumber)
    for (let column = 1; column <= Math.min(row.cellCount, MAX_COLUMNS); column++) {
      const value = cellText(row.getCell(column)).trim()
      const normalized = value.toLowerCase()
      if (!value || seen.has(normalized)) continue
      seen.add(normalized)
      result.push(value)
      if (result.length === 8) return result
    }
  }
  return result
}

function mergeExactDuplicates(contacts: ParsedContact[]): ParsedContact[] {
  const found = new Map<string, ParsedContact>()
  for (const contact of contacts) {
    const key = contact.email?.toLowerCase().trim()
      || contact.phone?.replace(/\D/g, "")
      || `${contact.first} ${contact.last}`.toLowerCase().trim()
    const existing = found.get(key)
    if (!existing) {
      found.set(key, contact)
      continue
    }
    if (contact.notes && !existing.notes?.includes(contact.notes)) {
      existing.notes = [existing.notes, contact.notes].filter(Boolean).join("\n\n")
    }
  }
  return Array.from(found.values())
}

function splitName(value: string): { first: string; last: string } {
  const trimmed = value.trim()
  if (trimmed.includes(",")) {
    const [last, ...first] = trimmed.split(",")
    return { first: first.join(",").trim(), last: last.trim() }
  }
  const parts = trimmed.split(/\s+/)
  return { first: parts.shift() ?? "", last: parts.join(" ") }
}

function normalizeHeader(value: string): string {
  return String(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value === null || value === undefined) return ""
  if (value instanceof Date) {
    if (value.getFullYear() <= 1900) {
      return value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    }
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if ("richText" in value) return value.richText.map(part => part.text).join("")
  if ("hyperlink" in value) return typeof value.text === "string" ? value.text : value.hyperlink
  if ("formula" in value) {
    const result = value.result
    if (result instanceof Date) return result.toISOString()
    return result === null || result === undefined ? "" : String(result)
  }
  if ("text" in value && typeof value.text === "string") return value.text
  return cell.text || ""
}
