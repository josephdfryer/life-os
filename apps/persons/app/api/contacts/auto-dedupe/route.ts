import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"

export const maxDuration = 120 // 2 min — scanning 8k contacts takes time

// Only auto-merge at very high confidence to avoid false positives
const AUTO_THRESHOLD = 0.93

// ── Inline Jaro-Winkler (can't import from client-only lib) ───────────────────

function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const l1 = s1.length, l2 = s2.length
  if (!l1 || !l2) return 0
  const md = Math.max(Math.floor(Math.max(l1, l2) / 2) - 1, 0)
  const m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false)
  let m = 0
  for (let i = 0; i < l1; i++) {
    for (let j = Math.max(0, i - md); j < Math.min(i + md + 1, l2); j++) {
      if (m2[j] || s1[i] !== s2[j]) continue
      m1[i] = m2[j] = true; m++; break
    }
  }
  if (!m) return 0
  let t = 0, k = 0
  for (let i = 0; i < l1; i++) {
    if (!m1[i]) continue
    while (!m2[k]) k++
    if (s1[i] !== s2[k]) t++
    k++
  }
  return (m / l1 + m / l2 + (m - t / 2) / m) / 3
}

function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b)
  let p = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) p++; else break
  }
  return j + p * 0.1 * (1 - j)
}

function norm(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "")
}

// ── Types ─────────────────────────────────────────────────────────────────────

type MinPerson = {
  id: string
  createdAt: Date
  first: string
  last: string
  email: string | null
  phone: string | null
  company: string | null
  location: string | null
  headline: string | null
  birthday: string | null
  notes: string | null
  linkedin: string | null
  twitter: string | null
  website: string | null
  tags: string
  values: string
  closeness: number
  color: string | null
  colorSoft: string | null
  _count: { interactions: number }
}

type PairResult = { keepId: string; deleteId: string; score: number; reason: string; keepName: string; deleteName: string }

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreMinimal(a: MinPerson, b: MinPerson): { score: number; reason: string } | null {
  // Exact email
  if (a.email && b.email && a.email.toLowerCase().trim() === b.email.toLowerCase().trim()) {
    return { score: 1.0, reason: "Same email address" }
  }
  // Exact phone
  const ap = (a.phone ?? "").replace(/\D/g, "")
  const bp = (b.phone ?? "").replace(/\D/g, "")
  if (ap.length >= 7 && ap === bp) {
    return { score: 0.97, reason: "Same phone number" }
  }
  // Name similarity
  const an = norm(`${a.first} ${a.last}`)
  const bn = norm(`${b.first} ${b.last}`)
  if (!an || !bn) return null
  const nameSim = jaroWinkler(an, bn)
  const sameCompany = !!(a.company && b.company && jaroWinkler(norm(a.company), norm(b.company)) > 0.85)

  if (nameSim >= 0.92) {
    const score = Math.min(1, nameSim + (sameCompany ? 0.03 : 0))
    return { score, reason: sameCompany ? "Similar name, same company" : "Very similar name" }
  }
  if (nameSim >= 0.82 && sameCompany) {
    return { score: nameSim, reason: "Similar name, same company" }
  }
  return null
}

// Pick which record to keep: more interactions > older createdAt
function pickKeeper(a: MinPerson, b: MinPerson): [MinPerson, MinPerson] {
  if (a._count.interactions !== b._count.interactions) {
    return a._count.interactions > b._count.interactions ? [a, b] : [b, a]
  }
  return a.createdAt <= b.createdAt ? [a, b] : [b, a]
}

// Fill null fields on keeper from loser
function buildPatch(keeper: MinPerson, loser: MinPerson): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const scalar = ["headline", "email", "phone", "company", "location",
    "birthday", "linkedin", "twitter", "website"] as const
  for (const key of scalar) {
    if (!keeper[key] && loser[key]) patch[key] = loser[key]
  }
  // Concatenate notes
  if (!keeper.notes && loser.notes) patch.notes = loser.notes
  else if (keeper.notes && loser.notes && keeper.notes !== loser.notes) {
    patch.notes = `${keeper.notes}\n\n---\n${loser.notes}`
  }
  // Union tags
  const kt = parseTags(keeper.tags) as string[]
  const lt = parseTags(loser.tags) as string[]
  const merged = Array.from(new Set([...kt, ...lt]))
  if (merged.length > kt.length) patch.tags = JSON.stringify(merged)
  // Higher closeness wins
  if (loser.closeness > keeper.closeness) patch.closeness = loser.closeness
  return patch
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST() {
  // 1. Load all persons (minimal fields only — no interactions join)
  const all = await db.person.findMany({
    select: {
      id: true, createdAt: true,
      first: true, last: true, email: true, phone: true,
      company: true, location: true, headline: true,
      birthday: true, notes: true, linkedin: true,
      twitter: true, website: true, tags: true, values: true,
      closeness: true, color: true, colorSoft: true,
      _count: { select: { interactions: true } },
    },
  })

  const deleted  = new Set<string>()
  const toMerge: PairResult[] = []

  // 2a. Exact email matches — O(n) via Map
  const byEmail = new Map<string, MinPerson[]>()
  for (const p of all) {
    if (!p.email?.trim()) continue
    const key = p.email.toLowerCase().trim()
    const bucket = byEmail.get(key) ?? []; bucket.push(p as MinPerson); byEmail.set(key, bucket)
  }
  for (const bucket of byEmail.values()) {
    if (bucket.length < 2) continue
    bucket.sort((a, b) => b._count.interactions - a._count.interactions || a.createdAt.getTime() - b.createdAt.getTime())
    const keeper = bucket[0]
    for (let i = 1; i < bucket.length; i++) {
      if (deleted.has(keeper.id) || deleted.has(bucket[i].id)) continue
      toMerge.push({ keepId: keeper.id, deleteId: bucket[i].id, score: 1.0, reason: "Same email address", keepName: `${keeper.first} ${keeper.last}`, deleteName: `${bucket[i].first} ${bucket[i].last}` })
      deleted.add(bucket[i].id)
    }
  }

  // 2b. Exact phone matches — O(n) via Map
  const byPhone = new Map<string, MinPerson[]>()
  for (const p of all) {
    const digits = (p.phone ?? "").replace(/\D/g, "")
    if (digits.length < 7) continue
    const bucket = byPhone.get(digits) ?? []; bucket.push(p as MinPerson); byPhone.set(digits, bucket)
  }
  for (const bucket of byPhone.values()) {
    if (bucket.length < 2) continue
    bucket.sort((a, b) => b._count.interactions - a._count.interactions || a.createdAt.getTime() - b.createdAt.getTime())
    const keeper = bucket[0]
    for (let i = 1; i < bucket.length; i++) {
      if (deleted.has(keeper.id) || deleted.has(bucket[i].id)) continue
      toMerge.push({ keepId: keeper.id, deleteId: bucket[i].id, score: 0.97, reason: "Same phone number", keepName: `${keeper.first} ${keeper.last}`, deleteName: `${bucket[i].first} ${bucket[i].last}` })
      deleted.add(bucket[i].id)
    }
  }

  // 2c. Name similarity — bucketed by last-name initial to avoid O(n²)
  const byInitial = new Map<string, MinPerson[]>()
  for (const p of all) {
    if (deleted.has(p.id) || !p.last) continue
    const key = p.last[0].toLowerCase()
    const bucket = byInitial.get(key) ?? []; bucket.push(p as MinPerson); byInitial.set(key, bucket)
  }
  for (const bucket of byInitial.values()) {
    for (let i = 0; i < bucket.length; i++) {
      if (deleted.has(bucket[i].id)) continue
      for (let j = i + 1; j < bucket.length; j++) {
        if (deleted.has(bucket[j].id)) continue
        const result = scoreMinimal(bucket[i], bucket[j])
        if (!result || result.score < AUTO_THRESHOLD) continue
        const [keeper, loser] = pickKeeper(bucket[i], bucket[j])
        toMerge.push({ keepId: keeper.id, deleteId: loser.id, score: result.score, reason: result.reason, keepName: `${keeper.first} ${keeper.last}`, deleteName: `${loser.first} ${loser.last}` })
        deleted.add(loser.id)
      }
    }
  }

  // 3. Execute all merges
  let merged = 0
  const results: PairResult[] = []

  for (const m of toMerge) {
    try {
      const [keeper, loser] = await Promise.all([
        db.person.findUnique({ where: { id: m.keepId } }),
        db.person.findUnique({ where: { id: m.deleteId } }),
      ])
      if (!keeper || !loser) continue

      const patch = buildPatch(
        { ...keeper, _count: { interactions: 0 } } as MinPerson,
        { ...loser,  _count: { interactions: 0 } } as MinPerson,
      )

      await db.$transaction(async tx => {
        if (Object.keys(patch).length > 0) {
          await tx.person.update({ where: { id: m.keepId }, data: patch })
        }
        await tx.interaction.updateMany({ where: { personId: m.deleteId }, data: { personId: m.keepId } })
        await tx.plan.updateMany({ where: { personId: m.deleteId }, data: { personId: m.keepId } })
        await tx.person.delete({ where: { id: m.deleteId } })
      })

      merged++
      results.push(m)
    } catch (e) {
      console.error("Auto-merge failed for pair", m.keepId, m.deleteId, e)
    }
  }

  return NextResponse.json({ merged, results })
}
