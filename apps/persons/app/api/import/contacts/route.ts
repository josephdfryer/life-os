import { NextRequest, NextResponse } from "next/server"
import { parseVCards } from "@/lib/vcard"
import { parseCSVRows } from "@/lib/csv-contacts"
import { detectColumnMapping, applyMapping } from "@/lib/contact-normalizer"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"
import { parseSpreadsheetContacts } from "@/lib/spreadsheet-contacts"

const MAX_SPREADSHEET_BYTES = 15 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    await requireAccess("people.write")
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData()
      const file = form.get("file")
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No spreadsheet provided" }, { status: 400 })
      }
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        return NextResponse.json({ error: "Spreadsheet imports currently support .xlsx files." }, { status: 400 })
      }
      if (file.size > MAX_SPREADSHEET_BYTES) {
        return NextResponse.json({ error: "Spreadsheet is larger than the 15 MB import limit." }, { status: 413 })
      }
      const result = await parseSpreadsheetContacts(Buffer.from(await file.arrayBuffer()), file.name)
      if (!result.contacts.length) {
        return NextResponse.json(
          { error: "No people table was found. Include a name column and at least one person row." },
          { status: 422 },
        )
      }
      return NextResponse.json({
        contacts: result.contacts,
        count: result.contacts.length,
        method: "spreadsheet",
        summary: result.summary,
      })
    }

    const body = await req.json()
    const { content, format }: { content: string; format?: string } = body

    if (!content?.trim()) {
      return NextResponse.json({ error: "No content provided" }, { status: 400 })
    }

    // ── vCard ──────────────────────────────────────────────────────────────
    if (format === "vcf" || content.trimStart().startsWith("BEGIN:VCARD")) {
      const contacts = parseVCards(content)
      if (!contacts.length) {
        return NextResponse.json({ error: "No valid contact records found" }, { status: 400 })
      }
      return NextResponse.json({ contacts, count: contacts.length, method: "vcard" })
    }

    // ── CSV — Claude column mapping ────────────────────────────────────────
    const allRows = parseCSVRows(content)
    if (allRows.length < 2) {
      return NextResponse.json({ error: "CSV appears to be empty" }, { status: 400 })
    }

    // Some exports prefix the real header with disclaimer lines — LinkedIn's
    // Connections.csv leads with a "Notes:" line and a paragraph, each just
    // one populated cell. Skip to the first row that actually looks like a
    // header (several populated columns) rather than assuming row 0 is it.
    const headerIndex = allRows.findIndex(r => r.filter(c => c.trim()).length >= 3)
    const rows = headerIndex > 0 ? allRows.slice(headerIndex) : allRows
    if (rows.length < 2) {
      return NextResponse.json({ error: "Could not find a header row with at least 3 columns" }, { status: 400 })
    }

    const header   = rows[0]
    const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()))

    if (!header.length) {
      return NextResponse.json({ error: "Could not read CSV header row" }, { status: 400 })
    }

    // Ask Claude to map columns → LifeOS standard (sends only header + 5 rows)
    let mapping
    try {
      mapping = await detectColumnMapping(header, dataRows.slice(0, 5))
    } catch (e) {
      console.error("Claude mapping failed, no fallback available:", e)
      return NextResponse.json(
        { error: "Could not determine column mapping. Please check the file format." },
        { status: 422 }
      )
    }

    const contacts = applyMapping(header, dataRows, mapping)

    if (!contacts.length) {
      return NextResponse.json(
        { error: "No people could be parsed. Columns detected: " + header.slice(0, 8).join(", ") },
        { status: 400 }
      )
    }

    return NextResponse.json({ contacts, count: contacts.length, method: "claude", mapping })
  } catch (error) {
    return handleRouteError(error)
  }
}
