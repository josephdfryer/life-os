import { NextRequest, NextResponse } from "next/server"
import { parseVCards } from "@/lib/vcard"
import { parseCsvContacts, detectCsvFlavor } from "@/lib/csv-contacts"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { content, format }: { content: string; format?: string } = body

    if (!content?.trim()) {
      return NextResponse.json({ error: "No content provided" }, { status: 400 })
    }

    let contacts

    if (format === "csv" || (!format && looksLikeCSV(content))) {
      contacts = parseCsvContacts(content)
      if (!contacts) {
        return NextResponse.json(
          { error: "This CSV doesn't look like a contacts export. Columns found: " + getHeaderRow(content) },
          { status: 400 }
        )
      }
    } else {
      // vCard (default)
      contacts = parseVCards(content)
      if (!contacts.length) {
        return NextResponse.json({ error: "No valid contact records found" }, { status: 400 })
      }
    }

    return NextResponse.json({ contacts, count: contacts.length })
  } catch (error) {
    console.error("Contact parse error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Parse failed" },
      { status: 500 }
    )
  }
}

function looksLikeCSV(content: string): boolean {
  const firstLine = content.split("\n")[0] ?? ""
  return firstLine.includes(",") && !firstLine.includes("BEGIN:VCARD")
}

function getHeaderRow(content: string): string {
  return content.split("\n")[0]?.slice(0, 120) ?? ""
}
