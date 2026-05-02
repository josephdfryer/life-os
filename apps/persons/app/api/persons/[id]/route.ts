import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import type { Interaction } from "@/types"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const person = await db.person.findUnique({
    where: { id },
    include: {
      interactions: {
        include: { event: true, sourceFile: true },
        orderBy: { timestamp: "desc" },
      },
      plans: {
        orderBy: { createdAt: "desc" },
      },
    },
  })

  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const interactions: Interaction[] = person.interactions.map(ix => ({
    ...ix,
    actionItems: parseTags(ix.actionItems) as unknown as string[],
    event: ix.event
      ? { ...ix.event, metadata: ix.event.metadata ? JSON.parse(ix.event.metadata) : null }
      : null,
  })) as unknown as Interaction[]

  return NextResponse.json({
    ...person,
    tags:   parseTags(person.tags),
    values: parseTags(person.values),
    emails: parseTags(person.emails),
    phones: parseTags(person.phones),
    interactions,
    plans: person.plans.map(p => ({
      ...p,
      successSignals: parseTags(p.successSignals),
      children: [],
    })),
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const {
    first, last, title, headline, company, emails, phones, birthday,
    closeness, tags, values, notes, location, linkedin, twitter, website,
  } = body

  const person = await db.person.update({
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
      ...(values !== undefined && { values: JSON.stringify(Array.isArray(values) ? values : []) }),
      ...(notes !== undefined && { notes: notes?.trim() || null }),
      ...(location !== undefined && { location: location?.trim() || null }),
      ...(linkedin !== undefined && { linkedin: linkedin?.trim() || null }),
      ...(twitter !== undefined && { twitter: twitter?.trim() || null }),
      ...(website !== undefined && { website: website?.trim() || null }),
    },
  })

  return NextResponse.json({ ...person, emails: parseTags(person.emails), phones: parseTags(person.phones) })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  await db.person.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
