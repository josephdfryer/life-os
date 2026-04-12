import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import { enrichWithAttention } from "@/lib/attention"
import type { Interaction } from "@/types"

export async function GET() {
  const persons = await db.person.findMany({
    include: {
      interactions: {
        include: { event: true, sourceFile: true },
        orderBy: { timestamp: "desc" },
      },
      plans: true,
    },
    orderBy: { createdAt: "asc" },
  })

  const enriched = persons.map(p => {
    const interactions: Interaction[] = p.interactions.map(ix => ({
      ...ix,
      actionItems: parseTags(ix.actionItems) as unknown as string[],
      event: ix.event
        ? { ...ix.event, metadata: ix.event.metadata ? JSON.parse(ix.event.metadata) : null }
        : null,
    })) as unknown as Interaction[]

    const person = {
      ...p,
      tags: parseTags(p.tags),
      values: parseTags(p.values),
      interactions,
      plans: p.plans,
    }

    return enrichWithAttention(person as Parameters<typeof enrichWithAttention>[0])
  })

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    first, last, headline, company, email, phone, birthday,
    closeness, tags, values, notes, location, linkedin, twitter, website,
    color, colorSoft,
  } = body

  const person = await db.person.create({
    data: {
      first: first.trim(),
      last: last.trim(),
      headline: headline?.trim() || null,
      company: company?.trim() || null,
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      birthday: birthday?.trim() || null,
      closeness: Number(closeness) || 2,
      tags: JSON.stringify(Array.isArray(tags) ? tags : []),
      values: JSON.stringify(Array.isArray(values) ? values : []),
      notes: notes?.trim() || null,
      location: location?.trim() || null,
      linkedin: linkedin?.trim() || null,
      twitter: twitter?.trim() || null,
      website: website?.trim() || null,
      color: color || null,
      colorSoft: colorSoft || null,
    },
  })

  return NextResponse.json(person, { status: 201 })
}
