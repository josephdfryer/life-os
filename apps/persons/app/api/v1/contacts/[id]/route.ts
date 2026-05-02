import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { validateApiKey, unauthorized } from "@/lib/api-auth"
import { parseTags } from "@/lib/utils"
import { formatPerson } from "../route"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  if (!validateApiKey(req)) return unauthorized()
  const { id } = await params

  const person = await db.person.findUnique({
    where: { id },
    include: {
      interactions: {
        include: { event: true, sourceFile: true },
        orderBy: { timestamp: "desc" },
      },
      plans: { orderBy: { createdAt: "desc" } },
    },
  })

  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    ...formatPerson(person as Record<string, unknown>),
    interactions: person.interactions.map(ix => ({
      ...ix,
      keyTopics: parseTags(ix.actionItems),
      event: ix.event
        ? { ...ix.event, metadata: ix.event.metadata ? JSON.parse(ix.event.metadata) : null }
        : null,
      file: ix.sourceFile
        ? { id: ix.sourceFile.id, filename: ix.sourceFile.filename, retrieveUrl: `/api/v1/files/${ix.sourceFile.id}` }
        : null,
    })),
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!validateApiKey(req)) return unauthorized()
  const { id } = await params
  const body = await req.json()

  const person = await db.person.findUnique({ where: { id } })
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const {
    first, last, title, headline, company, emails, phones, birthday,
    closeness, tags, notes, location, linkedin, twitter, website,
  } = body

  const updated = await db.person.update({
    where: { id },
    data: {
      ...(first !== undefined && { first: first.trim() }),
      ...(last !== undefined && { last: last.trim() }),
      ...(title !== undefined && { title: title?.trim() || null }),
      ...(headline !== undefined && { headline: headline?.trim() || null }),
      ...(company !== undefined && { company: company?.trim() || null }),
      ...(emails !== undefined && { emails: JSON.stringify(Array.isArray(emails) ? emails.map((e: string) => e.trim()).filter(Boolean) : []) }),
      ...(phones !== undefined && { phones: JSON.stringify(Array.isArray(phones) ? phones.map((p: string) => p.trim()).filter(Boolean) : []) }),
      ...(birthday !== undefined && { birthday: birthday?.trim() || null }),
      ...(closeness !== undefined && { closeness: Number(closeness) }),
      ...(tags !== undefined && { tags: JSON.stringify(Array.isArray(tags) ? tags : []) }),
      ...(notes !== undefined && { notes: notes?.trim() || null }),
      ...(location !== undefined && { location: location?.trim() || null }),
      ...(linkedin !== undefined && { linkedin: linkedin?.trim() || null }),
      ...(twitter !== undefined && { twitter: twitter?.trim() || null }),
      ...(website !== undefined && { website: website?.trim() || null }),
    },
  })

  return NextResponse.json(formatPerson(updated as Record<string, unknown>))
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!validateApiKey(req)) return unauthorized()
  const { id } = await params

  const person = await db.person.findUnique({ where: { id } })
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await db.person.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
