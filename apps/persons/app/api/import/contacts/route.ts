import { NextRequest, NextResponse } from "next/server"
import { parseVCards } from "@/lib/vcard"
import { parseCSVRows } from "@/lib/csv-contacts"
import { detectColumnMapping, applyMapping } from "@/lib/contact-normalizer"

export async function POST(req: NextRequest) {
  try {
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
    const rows = parseCSVRows(content)
    if (rows.length < 2) {
      return NextResponse.json({ error: "CSV appears to be empty" }, { status: 400 })
    }

    const header   = rows[0]
    const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()))

    if (!header.length) {
      return NextResponse.json({ error: "Could not read CSV header row" }, { status: 400 })
    }

    // Ask Claude to map columns → Life OS standard (sends only header + 5 rows)
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
    console.error("Contact import error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    )
  }
}
