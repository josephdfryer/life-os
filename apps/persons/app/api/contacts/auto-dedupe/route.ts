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
  emails: string  // JSON array
  phones: string  // JSON array
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
  // Any shared email
  const aEmails = parseTags(a.emails) as string[]
  const bEmails = parseTags(b.emails) as string[]
  if (aEmails.length && bEmails.length) {
    const bSet = new Set(bEmails.map(e => e.toLowerCase().trim()))
    if (aEmails.some(e => bSet.has(e.toLowerCase().trim()))) {
      return { score: 1.0, reason: "Same email address" }
    }
  }
  // Any shared phone
  const aPhones = (parseTags(a.phones) as string[]).map(p => p.replace(/\D/g, "")).filter(p => p.length >= 7)
  const bPhones = (parseTags(b.phones) as string[]).map(p => p.replace(/\D/g, "")).filter(p => p.length >= 7)
  if (aPhones.length && bPhones.length) {
    const bSet = new Set(bPhones)
    if (aPhones.some(p => bSet.has(p))) {
      return { score: 0.97, reason: "Same phone number" }
    }
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

// Merge non-null fields onto keeper from loser
function buildPatch(keeper: MinPerson, loser: MinPerson): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const scalar = ["headline", "company", "location",
    "birthday", "linkedin", "twitter", "website"] as const
  for (const key of scalar) {
    if (!keeper[key] && loser[key]) patch[key] = loser[key]
  }
  // Concatenate notes
  if (!keeper.notes && loser.notes) patch.notes = loser.notes
  else if (keeper.notes && loser.notes && keeper.notes !== loser.notes) {
    patch.notes = `${keeper.notes}\n\n---\n${loser.notes}`
  }
  // Union emails
  const ke = parseTags(keeper.emails) as string[]
  const le = parseTags(loser.emails) as string[]
  const mergedEmails = [...new Set([...ke, ...le])]
  if (mergedEmails.length > ke.length) patch.emails = JSON.stringify(mergedEmails)
  // Union phones
  const kp = parseTags(keeper.phones) as string[]
  const lp = parseTags(loser.phones) as string[]
  const mergedPhones = [...new Set([...kp, ...lp])]
  if (mergedPhones.length > kp.length) patch.phones = JSON.stringify(mergedPhones)
  // Union tags
  const kt = parseTags(keeper.tags) as string[]
  const lt = parseTags(loser.tags) as string[]
  const mergedTags = Array.from(new Set([...kt, ...lt]))
  if (mergedTags.length > kt.length) patch.tags = JSON.stringify(mergedTags)
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
      first: true, last: true, emails: true, phones: true,
      company: true, location: true, headline: true,
      birthday: true, notes: true, linkedin: true,
      twitter: true, website: true, tags: true, values: true,
      closeness: true, color: true, colorSoft: true,
      _count: { select: { interactions: true } },
    },
  })

  const deleted  = new Set<string>()
  const toMerge: PairResult[] = []

  // 2a. Exact email matches — O(n) via Map (iterate each email in each person's array)
  const byEmail = new Map<string, MinPerson[]>()
  for (const p of all) {
    const emails = parseTags(p.emails) as string[]
    for (const email of emails) {
      if (!email?.trim()) continue
      const key = email.toLowerCase().trim()
      const bucket = byEmail.get(key) ?? []; bucket.push(p as MinPerson); byEmail.set(key, bucket)
    }
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

  // 2b. Exact phone matches — O(n) via Map (iterate each phone in each person's array)
  const byPhone = new Map<string, MinPerson[]>()
  for (const p of all) {
    const phones = parseTags(p.phones) as string[]
    for (const phone of phones) {
      const digits = phone.replace(/\D/g, "")
      if (digits.length < 7) continue
      const bucket = byPhone.get(digits) ?? []; bucket.push(p as MinPerson); byPhone.set(digits, bucket)
    }
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

  // 2c. Name similarity — 3-char prefix buckets keep each bucket small (~10-30 people)
  //     even for large datasets, avoiding runaway O(n²) within common initials like "S".
  //     JW > 0.92 almost always means shared first 3 chars, so we don't miss real dupes.
  const byPrefix = new Map<string, MinPerson[]>()
  for (const p of all) {
    if (deleted.has(p.id) || !p.last) continue
    const key = norm(p.last).slice(0, 3).padEnd(3, "_")
    const bucket = byPrefix.get(key) ?? []; bucket.push(p as MinPerson); byPrefix.set(key, bucket)
  }
  for (const bucket of byPrefix.values()) {
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

  // Build a fast ID lookup from the already-loaded data
  const byId = new Map<string, MinPerson>(all.map(p => [p.id, p as MinPerson]))

  // 3. Execute merges in batched transactions — each batch = 1 Turso round trip
  //    instead of N sequential round trips (N * ~200ms killed the 10s timeout).
  //    Operations within each batch are ordered: reassign → delete (CASCADE safety).
  const BATCH_SIZE = 80
  let merged = 0
  const results: PairResult[] = []

  for (let start = 0; start < toMerge.length; start += BATCH_SIZE) {
    const batch = toMerge.slice(start, start + BATCH_SIZE)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops: any[] = []
    const batchValid: PairResult[] = []

    for (const m of batch) {
      const keeper = byId.get(m.keepId)
      const loser  = byId.get(m.deleteId)
      if (!keeper || !loser) continue

      const patch = buildPatch(keeper, loser)
      if (Object.keys(patch).length > 0) {
        ops.push(db.person.update({ where: { id: m.keepId }, data: patch }))
      }
      // reassign before delete — avoids CASCADE wiping interactions/plans
      ops.push(db.interaction.updateMany({ where: { personId: m.deleteId }, data: { personId: m.keepId } }))
      ops.push(db.plan.updateMany({ where: { personId: m.deleteId }, data: { personId: m.keepId } }))
      ops.push(db.person.delete({ where: { id: m.deleteId } }))
      batchValid.push(m)
    }

    if (ops.length > 0) {
      try {
        await db.$transaction(ops)
        merged += batchValid.length
        results.push(...batchValid)
      } catch (e) {
        console.error(`Batch ${start / BATCH_SIZE} failed:`, e)
      }
    }
  }

  return NextResponse.json({ merged, results })
}
