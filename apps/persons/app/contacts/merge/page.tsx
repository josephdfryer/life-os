import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import { findDuplicates } from "@/lib/dedupe"
import MergeDuplicatesUI from "./MergeDuplicatesUI"
import type { Person } from "@/types"

export const dynamic = "force-dynamic"

export default async function MergePage() {
  const rows = await db.person.findMany({
    include: { _count: { select: { interactions: true, plans: true } } },
  })

  const persons = rows.map(p => ({
    ...(p as unknown as Person),
    tags:   parseTags(p.tags),
    values: parseTags(p.values),
    emails: parseTags(p.emails),
    phones: parseTags(p.phones),
    interactionCount: p._count.interactions,
    planCount: p._count.plans,
  }))

  const pairs = findDuplicates(persons)

  return <MergeDuplicatesUI initialPairs={pairs} />
}
