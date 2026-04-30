import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"

type PairInput = { keepId: string; deleteId: string }

function buildPatch(
  keeper: Record<string, unknown>,
  loser: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}

  // Scalar fields: use keeper's value, fall back to loser's if keeper is empty
  for (const key of ["headline", "company", "location", "birthday", "linkedin", "twitter", "website"]) {
    if (!keeper[key] && loser[key]) patch[key] = loser[key]
  }

  // Notes: concatenate if both have them
  if (!keeper.notes && loser.notes) {
    patch.notes = loser.notes
  } else if (keeper.notes && loser.notes && keeper.notes !== loser.notes) {
    patch.notes = `${keeper.notes}\n\n---\n${loser.notes}`
  }

  // Higher closeness wins
  if ((loser.closeness as number) > (keeper.closeness as number)) {
    patch.closeness = loser.closeness
  }

  // Union arrays
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

export async function POST(req: NextRequest) {
  const { pairs } = await req.json() as { pairs: PairInput[] }

  if (!Array.isArray(pairs) || pairs.length === 0) {
    return NextResponse.json({ error: "pairs required" }, { status: 400 })
  }

  // Validate no duplicate or self-referential IDs
  const allIds = new Set<string>()
  for (const { keepId, deleteId } of pairs) {
    if (!keepId || !deleteId || keepId === deleteId) {
      return NextResponse.json({ error: "Invalid pair" }, { status: 400 })
    }
    allIds.add(keepId)
    allIds.add(deleteId)
  }

  // Load all persons involved in one query
  const persons = await db.person.findMany({
    where: { id: { in: [...allIds] } },
  })
  const byId = new Map(persons.map(p => [p.id, p as unknown as Record<string, unknown>]))

  // Build ops for a single batched transaction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: any[] = []
  const merged: string[] = []

  for (const { keepId, deleteId } of pairs) {
    const keeper = byId.get(keepId)
    const loser  = byId.get(deleteId)
    if (!keeper || !loser) continue

    const patch = buildPatch(keeper, loser)
    if (Object.keys(patch).length > 0) {
      ops.push(db.person.update({ where: { id: keepId }, data: patch }))
    }
    ops.push(db.interaction.updateMany({ where: { personId: deleteId }, data: { personId: keepId } }))
    ops.push(db.plan.updateMany({ where: { personId: deleteId }, data: { personId: keepId } }))
    ops.push(db.person.delete({ where: { id: deleteId } }))
    merged.push(deleteId)
  }

  if (ops.length > 0) {
    try {
      await db.$transaction(ops)
    } catch (err) {
      console.error("[merge-batch] transaction failed", { pairCount: pairs.length, err })
      return NextResponse.json({ error: "Transaction failed" }, { status: 500 })
    }
  }

  console.log("[merge-batch] merged", { count: merged.length })
  return NextResponse.json({ merged: merged.length, deletedIds: merged })
}
