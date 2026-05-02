import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"

// Accepts a list of {aId, bId} pairs, groups them into connected components
// via union-find, then merges each component into one record (most interactions wins).

type PairInput = { aId: string; bId: string }

function buildComponents(pairs: PairInput[]): string[][] {
  const parent: Record<string, string> = {}

  function find(x: string): string {
    if (!parent[x]) parent[x] = x
    if (parent[x] !== x) parent[x] = find(parent[x])
    return parent[x]
  }
  function union(x: string, y: string) {
    const rx = find(x), ry = find(y)
    if (rx !== ry) parent[rx] = ry
  }

  for (const { aId, bId } of pairs) union(aId, bId)

  const allIds = new Set(pairs.flatMap(p => [p.aId, p.bId]))
  const groups = new Map<string, string[]>()
  for (const id of allIds) {
    const root = find(id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(id)
  }
  return [...groups.values()].filter(g => g.length >= 2)
}

function buildClusterPatch(
  keeper: Record<string, unknown>,
  losers: Record<string, unknown>[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}

  for (const key of ["title", "headline", "company", "location", "birthday", "linkedin", "twitter", "website"]) {
    if (!keeper[key]) {
      const val = losers.find(l => l[key])?.[key]
      if (val) patch[key] = val
    }
  }

  const notesList = [
    typeof keeper.notes === "string" && keeper.notes.trim() ? keeper.notes.trim() : null,
    ...losers.map(l => typeof l.notes === "string" && (l.notes as string).trim() ? (l.notes as string).trim() : null),
  ].filter((n): n is string => n !== null)
  const uniqueNotes = [...new Set(notesList)]
  if (uniqueNotes.length > 1) patch.notes = uniqueNotes.join("\n\n---\n")
  else if (uniqueNotes.length === 1 && !keeper.notes) patch.notes = uniqueNotes[0]

  const maxCloseness = Math.max(keeper.closeness as number, ...losers.map(l => l.closeness as number))
  if (maxCloseness > (keeper.closeness as number)) patch.closeness = maxCloseness

  for (const field of ["emails", "phones", "tags", "values"]) {
    const kArr = parseTags(keeper[field] as string)
    const merged = [...kArr]
    for (const l of losers) {
      for (const v of parseTags(l[field] as string)) {
        if (!merged.includes(v)) merged.push(v)
      }
    }
    if (merged.length > kArr.length) patch[field] = JSON.stringify(merged)
  }

  return patch
}

export async function POST(req: NextRequest) {
  const { pairs } = await req.json() as { pairs: PairInput[] }

  if (!Array.isArray(pairs) || pairs.length === 0) {
    return NextResponse.json({ error: "pairs required" }, { status: 400 })
  }

  const components = buildComponents(pairs)
  if (components.length === 0) {
    return NextResponse.json({ merged: 0, deletedIds: [] })
  }

  const allIds = [...new Set(components.flat())]
  const persons = await db.person.findMany({
    where: { id: { in: allIds } },
    select: {
      id: true, createdAt: true,
      first: true, last: true,
      title: true, headline: true, company: true, location: true,
      birthday: true, linkedin: true, twitter: true, website: true,
      notes: true, closeness: true,
      emails: true, phones: true, tags: true, values: true,
      _count: { select: { interactions: true } },
    },
  })
  const byId = new Map(persons.map(p => [p.id, p]))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: any[] = []
  const allDeletedIds: string[] = []

  for (const component of components) {
    const members = component.map(id => byId.get(id)).filter(Boolean) as typeof persons
    if (members.length < 2) continue

    const sorted = [...members].sort((a, b) =>
      b._count.interactions - a._count.interactions ||
      a.createdAt.getTime() - b.createdAt.getTime()
    )
    const keeper = sorted[0]
    const losers = sorted.slice(1)

    const patch = buildClusterPatch(
      keeper as unknown as Record<string, unknown>,
      losers as unknown as Record<string, unknown>[],
    )
    if (Object.keys(patch).length > 0) {
      ops.push(db.person.update({ where: { id: keeper.id }, data: patch }))
    }
    for (const loser of losers) {
      ops.push(db.interaction.updateMany({ where: { personId: loser.id }, data: { personId: keeper.id } }))
      ops.push(db.plan.updateMany({ where: { personId: loser.id }, data: { personId: keeper.id } }))
      ops.push(db.person.delete({ where: { id: loser.id } }))
      allDeletedIds.push(loser.id)
    }
  }

  if (ops.length > 0) {
    try {
      await db.$transaction(ops)
    } catch (err) {
      console.error("[merge-cluster] transaction failed", { opCount: ops.length, err })
      return NextResponse.json({ error: "Transaction failed" }, { status: 500 })
    }
  }

  console.log("[merge-cluster] merged", { count: allDeletedIds.length })
  return NextResponse.json({ merged: allDeletedIds.length, deletedIds: allDeletedIds })
}
