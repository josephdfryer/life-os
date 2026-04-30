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

// Jaro-Winkler: prefix bonus up to 4 chars, scaling factor p=0.1
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
  // Any shared email → definite duplicate
  const aEmails = a.emails.map(e => norm(e)).filter(Boolean)
  const bEmailSet = new Set(b.emails.map(e => norm(e)).filter(Boolean))
  if (aEmails.length && bEmailSet.size && aEmails.some(e => bEmailSet.has(e))) {
    return { score: 1.0, reason: "Same email address" }
  }

  // Any shared phone (digits only)
  const aPhones = a.phones.map(p => p.replace(/\D/g, "")).filter(p => p.length >= 7)
  const bPhoneSet = new Set(b.phones.map(p => p.replace(/\D/g, "")).filter(p => p.length >= 7))
  if (aPhones.length && bPhoneSet.size && aPhones.some(p => bPhoneSet.has(p))) {
    return { score: 0.97, reason: "Same phone number" }
  }

  // Full-name Jaro-Winkler
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

export function findDuplicates(
  persons: (Person & { interactionCount: number; planCount: number })[],
): DupePair[] {
  const pairs: DupePair[] = []

  for (let i = 0; i < persons.length; i++) {
    for (let j = i + 1; j < persons.length; j++) {
      const result = scorePair(persons[i], persons[j])
      if (result) {
        pairs.push({ ...result, a: persons[i], b: persons[j] })
      }
    }
  }

  return pairs.sort((a, b) => b.score - a.score)
}
