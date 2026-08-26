import { NextRequest, NextResponse } from "next/server"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"
import { parseInstagramContacts, type InstagramRelationship } from "@/lib/instagram-contacts"
import type { ParsedContact } from "@/lib/vcard"

const MAX_FILES = 20
const MAX_FILE_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    await requireAccess("people.write")

    const form = await req.formData()
    const relationship: InstagramRelationship = form.get("relationship") === "following" ? "following" : "follower"
    const files = form.getAll("files").filter((f): f is File => f instanceof File)
    if (!files.length) return NextResponse.json({ error: "No files provided" }, { status: 400 })
    if (files.length > MAX_FILES) return NextResponse.json({ error: `Too many files — max ${MAX_FILES} at a time` }, { status: 400 })
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: `${file.name} is larger than the 10 MB limit` }, { status: 413 })
    }

    const seen = new Set<string>()
    const contacts: ParsedContact[] = []
    for (const file of files) {
      const text = await file.text()
      for (const contact of parseInstagramContacts(text, relationship)) {
        if (contact.instagram) {
          if (seen.has(contact.instagram)) continue
          seen.add(contact.instagram)
        }
        contacts.push(contact)
      }
    }

    if (!contacts.length) {
      return NextResponse.json(
        { error: "No Instagram usernames were found. Make sure you uploaded the JSON files from Instagram's data export, not the HTML ones." },
        { status: 422 },
      )
    }

    return NextResponse.json({ contacts, count: contacts.length, method: "instagram" })
  } catch (error) {
    return handleRouteError(error)
  }
}
