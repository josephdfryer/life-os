import type { Person } from "@/types"

// ── Jaro similarity ──────────────────────────────────────────────────────────

function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const len1 = s1.length, len2 = s2.length
  if (len1 === 0 || len2 === 0) return 0

  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0)
  const s1m = new Array(len1).fill(false)
  const s2m = new Array(len2).fill(false)
  let matches = 0

  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - matchDist)
    const hi = Math.min(i + matchDist + 1, len2)
    for (let j = lo; j < hi; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue
      s1m[i] = true; s2m[j] = true; matches++; break
    }
  }

  if (matches === 0) return 0

  let t = 0, k = 0
  for (let i = 0; i < len1; i++) {
    if (!s1m[i]) continue
    while (!s2m[k]) k++
    if (s1[i] !== s2[k]) t++
    k++
  }

  return (matches / len1 + matches / len2 + (matches - t / 2) / matches) / 3
}

function jaroWinkler(s1: string, s2: string): number {
  const j = jaro(s1, s2)
  let prefix = 0
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++; else break
  }
  return j + prefix * 0.1 * (1 - j)
}

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "")
}

// ── Types ────────────────────────────────────────────────────────────────────

export type DupePair = {
  score: number
  reason: string
  a: Person & { interactionCount: number; planCount: number }
  b: Person & { interactionCount: number; planCount: number }
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export function scorePair(
  a: Person,
  b: Person,
): { score: number; reason: string } | null {
  const aEmails = (a.emails as unknown as string[]).map(e => norm(e)).filter(Boolean)
  const bEmailSet = new Set((b.emails as unknown as string[]).map(e => norm(e)).filter(Boolean))
  if (aEmails.length && bEmailSet.size && aEmails.some(e => bEmailSet.has(e))) {
    return { score: 1.0, reason: "Same email address" }
  }

  const aPhones = (a.phones as unknown as string[]).map(p => p.replace(/\D/g, "")).filter(p => p.length >= 7)
  const bPhoneSet = new Set((b.phones as unknown as string[]).map(p => p.replace(/\D/g, "")).filter(p => p.length >= 7))
  if (aPhones.length && bPhoneSet.size && aPhones.some(p => bPhoneSet.has(p))) {
    return { score: 0.97, reason: "Same phone number" }
  }

  const aFull = norm(`${a.first} ${a.last}`)
  const bFull = norm(`${b.first} ${b.last}`)
  const nameSim = jaroWinkler(aFull, bFull)

  const sameCompany =
    !!(a.company && b.company &&
      jaroWinkler(norm(a.company), norm(b.company)) > 0.85)
  const sameLocation =
    !!(a.location && b.location && norm(a.location) === norm(b.location))

  if (nameSim >= 0.92) {
    const boost = sameCompany ? 0.03 : 0
    return {
      score: Math.min(1, nameSim + boost),
      reason: sameCompany ? "Similar name, same company" : "Very similar name",
    }
  }

  if (nameSim >= 0.80 && (sameCompany || sameLocation)) {
    return {
      score: nameSim,
      reason: sameCompany ? "Similar name, same company" : "Similar name, same location",
    }
  }

  return null
}

// ── findDuplicates — efficient multi-strategy scan ───────────────────────────
//
// Strategy:
//   1. Email matches:  O(n) via hashmap — build email→[indices], find collisions
//   2. Phone matches:  O(n) via hashmap — same pattern
//   3. Name similarity: 3-char last-name prefix buckets — limits inner loop to
//      ~10–30 people per bucket instead of n², and JW ≥ 0.92 always shares 3 chars.
//
// Pre-computing normalized values once cuts redundant string work in the inner loop.

export function findDuplicates(
  persons: (Person & { interactionCount: number; planCount: number })[],
): DupePair[] {
  // Pre-compute enriched values for each person
  const enriched = persons.map(p => ({
    p,
    emails: new Set((p.emails as unknown as string[]).map(e => norm(e)).filter(Boolean)),
    phones: new Set((p.phones as unknown as string[]).map(ph => ph.replace(/\D/g, "")).filter(ph => ph.length >= 7)),
    fullName: norm(`${p.first} ${p.last}`),
    company: p.company ? norm(p.company) : null,
    location: p.location ? norm(p.location) : null,
  }))

  const pairs: DupePair[] = []
  // Track index pairs already found via email/phone to avoid duplicates in name pass
  const seen = new Set<string>()

  function addPair(i: number, j: number, score: number, reason: string) {
    const key = `${Math.min(i, j)}:${Math.max(i, j)}`
    if (seen.has(key)) return
    seen.add(key)
    pairs.push({ score, reason, a: enriched[i].p, b: enriched[j].p })
  }

  // 1. Exact email match — O(total emails)
  const byEmail = new Map<string, number[]>()
  for (let i = 0; i < enriched.length; i++) {
    for (const email of enriched[i].emails) {
      const bucket = byEmail.get(email) ?? []
      bucket.push(i)
      byEmail.set(email, bucket)
    }
  }
  for (const bucket of byEmail.values()) {
    if (bucket.length < 2) continue
    for (let x = 0; x < bucket.length; x++)
      for (let y = x + 1; y < bucket.length; y++)
        addPair(bucket[x], bucket[y], 1.0, "Same email address")
  }

  // 2. Exact phone match — O(total phones)
  const byPhone = new Map<string, number[]>()
  for (let i = 0; i < enriched.length; i++) {
    for (const phone of enriched[i].phones) {
      const bucket = byPhone.get(phone) ?? []
      bucket.push(i)
      byPhone.set(phone, bucket)
    }
  }
  for (const bucket of byPhone.values()) {
    if (bucket.length < 2) continue
    for (let x = 0; x < bucket.length; x++)
      for (let y = x + 1; y < bucket.length; y++)
        addPair(bucket[x], bucket[y], 0.97, "Same phone number")
  }

  // 3. Name similarity via 3-char last-name prefix buckets
  const byPrefix = new Map<string, number[]>()
  for (let i = 0; i < enriched.length; i++) {
    const last = enriched[i].p.last
    const prefix = last ? norm(last).slice(0, 3).padEnd(3, "_") : "___"
    const bucket = byPrefix.get(prefix) ?? []
    bucket.push(i)
    byPrefix.set(prefix, bucket)
  }
  for (const bucket of byPrefix.values()) {
    for (let x = 0; x < bucket.length; x++) {
      const i = bucket[x]
      const ea = enriched[i]
      for (let y = x + 1; y < bucket.length; y++) {
        const j = bucket[y]
        const key = `${Math.min(i, j)}:${Math.max(i, j)}`
        if (seen.has(key)) continue // already matched via email/phone

        const eb = enriched[j]
        const nameSim = jaroWinkler(ea.fullName, eb.fullName)
        const sameCompany =
          !!(ea.company && eb.company && jaroWinkler(ea.company, eb.company) > 0.85)
        const sameLocation =
          !!(ea.location && eb.location && ea.location === eb.location)

        if (nameSim >= 0.92) {
          const boost = sameCompany ? 0.03 : 0
          addPair(i, j, Math.min(1, nameSim + boost), sameCompany ? "Similar name, same company" : "Very similar name")
        } else if (nameSim >= 0.80 && (sameCompany || sameLocation)) {
          addPair(i, j, nameSim, sameCompany ? "Similar name, same company" : "Similar name, same location")
        }
      }
    }
  }

  return pairs.sort((a, b) => b.score - a.score)
}
