import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"

// Groups all persons by normalised email address and merges each cluster
// down to a single record, keeping the one with the most interactions.
// This avoids the pairwise conflict where person B appears as both a
// "keeper" and a "to-delete" in overlapping pairs.

function buildPatch(
  keeper: Record<string, unknown>,
  loser: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}

  for (const key of ["headline", "company", "location", "birthday", "linkedin", "twitter", "website"]) {
    if (!keeper[key] && loser[key]) patch[key] = loser[key]
  }

  if (!keeper.notes && loser.notes) {
    patch.notes = loser.notes
  } else if (keeper.notes && loser.notes && keeper.notes !== loser.notes) {
    patch.notes = `${keeper.notes}\n\n---\n${loser.notes}`
  }

  if ((loser.closeness as number) > (keeper.closeness as number)) {
    patch.closeness = loser.closeness
  }

  const ke = parseTags(keeper.emails as string)
  const le = parseTags(loser.emails as string)
  const mergedEmails = [...new Set([...ke, ...le])]
  if (mergedEmails.length > ke.length) patch.emails = JSON.stringify(mergedEmails)

  const kp = parseTags(keeper.phones as string)
  const lp = parseTags(loser.phones as string)
  const mergedPhones = [...new Set([...kp, ...lp])]
  if (mergedPhones.length > kp.length) patch.phones = JSON.stringify(mergedPhones)

  const kt = parseTags(keeper.tags as string)
  const lt = parseTags(loser.tags as string)
  const mergedTags = [...new Set([...kt, ...lt])]
  if (mergedTags.length > kt.length) patch.tags = JSON.stringify(mergedTags)

  const kv = parseTags(keeper.values as string)
  const lv = parseTags(loser.values as string)
  const mergedValues = [...new Set([...kv, ...lv])]
  if (mergedValues.length > kv.length) patch.values = JSON.stringify(mergedValues)

  return patch
}

export async function POST() {
  const all = await db.person.findMany({
    select: {
      id: true, createdAt: true,
      first: true, last: true,
      headline: true, company: true, location: true,
      birthday: true, linkedin: true, twitter: true, website: true,
      notes: true, closeness: true,
      emails: true, phones: true, tags: true, values: true,
      color: true, colorSoft: true,
      _count: { select: { interactions: true } },
    },
  })

  // Group persons by normalized email — O(n * emails per person)
  const byEmail = new Map<string, typeof all>()
  for (const p of all) {
    for (const email of parseTags(p.emails as string)) {
      const key = email.toLowerCase().trim()
      if (!key) continue
      const bucket = byEmail.get(key) ?? []
      bucket.push(p)
      byEmail.set(key, bucket)
    }
  }

  // For each email group: pick the keeper, queue up the rest as losers
  const deleted = new Set<string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: any[] = []
  const deletedIds: string[] = []

  for (const bucket of byEmail.values()) {
    if (bucket.length < 2) continue

    // Keeper = most interactions, then oldest record as tiebreaker
    const sorted = [...bucket].sort((a, b) =>
      b._count.interactions - a._count.interactions ||
      a.createdAt.getTime() - b.createdAt.getTime()
    )
    const keeper = sorted[0]

    for (let i = 1; i < sorted.length; i++) {
      const loser = sorted[i]
      if (deleted.has(loser.id) || deleted.has(keeper.id)) continue

      const patch = buildPatch(
        keeper as unknown as Record<string, unknown>,
        loser as unknown as Record<string, unknown>,
      )
      if (Object.keys(patch).length > 0) {
        ops.push(db.person.update({ where: { id: keeper.id }, data: patch }))
      }
      // Reassign before delete to avoid FK issues
      ops.push(db.interaction.updateMany({ where: { personId: loser.id }, data: { personId: keeper.id } }))
      ops.push(db.plan.updateMany({ where: { personId: loser.id }, data: { personId: keeper.id } }))
      ops.push(db.person.delete({ where: { id: loser.id } }))

      deleted.add(loser.id)
      deletedIds.push(loser.id)
    }
  }

  if (ops.length === 0) {
    return NextResponse.json({ merged: 0, deletedIds: [] })
  }

  try {
    await db.$transaction(ops)
  } catch (err) {
    console.error("[merge-same-email] transaction failed", { opCount: ops.length, err })
    return NextResponse.json({ error: "Transaction failed" }, { status: 500 })
  }

  console.log("[merge-same-email] merged", { count: deletedIds.length })
  return NextResponse.json({ merged: deletedIds.length, deletedIds })
}
