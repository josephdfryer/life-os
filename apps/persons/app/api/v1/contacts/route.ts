import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { validateApiKey, unauthorized } from "@/lib/api-auth"
import { assignColor } from "@/lib/colors"
import { parseTags } from "@/lib/utils"

export async function GET(req: NextRequest) {
  if (!validateApiKey(req)) return unauthorized()

  const persons = await db.person.findMany({
    include: { interactions: { orderBy: { timestamp: "desc" } }, plans: true },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(persons.map(formatPerson))
}

export async function POST(req: NextRequest) {
  if (!validateApiKey(req)) return unauthorized()

  const body = await req.json()
  const {
    first, last, headline, company, email, phone, birthday,
    closeness, tags, notes, location, linkedin, twitter, website,
  } = body

  if (!first || !last) {
    return NextResponse.json({ error: "first and last are required" }, { status: 400 })
  }

  const count = await db.person.count()
  const { color, colorSoft } = assignColor(count)

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
      values: JSON.stringify([]),
      notes: notes?.trim() || null,
      location: location?.trim() || null,
      linkedin: linkedin?.trim() || null,
      twitter: twitter?.trim() || null,
      website: website?.trim() || null,
      color,
      colorSoft,
    },
  })

  return NextResponse.json(formatPerson(person), { status: 201 })
}

export function formatPerson(p: Record<string, unknown>) {
  return {
    ...p,
    tags: parseTags(p.tags as string),
    values: parseTags(p.values as string),
  }
}
