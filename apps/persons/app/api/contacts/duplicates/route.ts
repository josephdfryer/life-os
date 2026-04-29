import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import { findDuplicates } from "@/lib/dedupe"
import type { Person } from "@/types"

export async function GET() {
  const persons = await db.person.findMany({
    include: {
      _count: { select: { interactions: true, plans: true } },
    },
  })

  const parsed = persons.map(p => ({
    ...(p as unknown as Person),
    tags:   parseTags(p.tags),
    values: parseTags(p.values),
    emails: parseTags(p.emails),
    phones: parseTags(p.phones),
    interactionCount: p._count.interactions,
    planCount: p._count.plans,
  }))

  const pairs = findDuplicates(parsed)
  return NextResponse.json(pairs)
}
