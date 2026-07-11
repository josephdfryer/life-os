#!/usr/bin/env tsx
// Era transaction → Place matcher.
//
// Joins staged Era transactions against Google Timeline visits (imported and
// Claude-enriched in the Places app) to find where each physical transaction
// happened, with a calibrated confidence score.
//
// Scoring: independent evidence signals (name similarity, category
// compatibility, same-day visit) are combined as likelihood ratios in
// log-odds space against a prior of 1/candidates. High-band matches
// (≥0.90) are accepted from the deterministic score alone; the ambiguous
// middle band goes to Claude for adjudication with the full evidence.
// Results land in StagedInteraction.metadata.placeMatch — nothing is
// auto-accepted into the graph.
//
// Usage: npx tsx scripts/era/match-places.ts [--dry-run] [--limit N]

import fs from "node:fs"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")

for (const candidate of [path.join(REPO_ROOT, ".env"), path.join(REPO_ROOT, "apps/persons/.env")]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const PLACES_ENV = path.join(REPO_ROOT, "apps/places/.env.local")
if (fs.existsSync(PLACES_ENV)) {
  for (const line of fs.readFileSync(PLACES_ENV, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && (process.env[m[1]] === undefined || process.env[m[1]] === "")) process.env[m[1]] = m[2]
  }
}
const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY
const GEOCODE_CACHE_PATH = path.join(REPO_ROOT, "logs", "merchant-geocode-cache.json")

const WORKSPACE_ID = "default-workspace"
const TZ = "America/Los_Angeles" // Vegas — transaction dates are local
const AUTO_THRESHOLD = 0.9
const ADJUDICATE_FLOOR = 0.25
const LLM_BATCH = 12
const MODEL = "claude-sonnet-4-6"

type Txn = {
  stagedId: string
  eraId: string
  date: string
  merchant: string
  merchantNorm: string
  city: string | null
  category: string | null
  amount: number
  online: boolean
  transfer: boolean
}

type Visit = {
  id: string
  googlePlaceId: string | null
  startedAt: Date
  endedAt: Date | null
  localDate: string
  name: string | null
  category: string | null
  enrichConfidence: number | null
  resolvedPlaceId: string | null
  lat: number | null
  lng: number | null
}

type Geocode = { name: string; lat: number; lng: number; types: string[]; placeId: string | null } | null

type Candidate = {
  visit: Visit
  nameSim: number
  catMatch: boolean | null
  distanceM: number | null
  score: number
}

type MatchResult = {
  stagedId: string
  merchant: string
  date: string
  band: "auto" | "adjudicated" | "unmatched" | "online" | "transfer"
  visitId?: string
  googlePlaceId?: string | null
  placeName?: string | null
  // The merchant's own resolved place — the node Places should create/link.
  // The visit corroborates presence; the merchant geocode is the true venue.
  merchantPlace?: { name: string; lat: number; lng: number; googlePlaceId: string | null } | null
  confidence?: number
  evidence?: string[]
  reasoning?: string
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const limitArg = process.argv.indexOf("--limit")
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity

  const { db } = await import("@life-os/db")

  // ── Load transactions ────────────────────────────────────────
  const stagedRows = await db.stagedInteraction.findMany({
    where: { workspaceId: WORKSPACE_ID, source: "era", status: "pending" },
    select: { id: true, sourceId: true, timestamp: true, contactName: true, metadata: true },
    orderBy: { timestamp: "desc" },
  })

  const txns: Txn[] = stagedRows.map(row => {
    const meta = safeJson(row.metadata) as Record<string, unknown>
    const raw = String(meta.rawDescription ?? row.contactName ?? "")
    const city = parseCityState(raw)
    return {
      stagedId: row.id,
      eraId: String(meta.eraTransactionId ?? row.sourceId),
      date: localDate(row.timestamp, "UTC"), // stored as UTC midnight of transaction_date
      merchant: String(row.contactName ?? ""),
      merchantNorm: normalizeMerchant(String(row.contactName ?? ""), raw),
      city,
      category: (meta.eraCategory as string) ?? null,
      amount: Number(meta.amount ?? 0),
      online: isOnline(raw, String(row.contactName ?? ""), city, (meta.eraCategory as string) ?? null),
      transfer: Boolean(meta.transfer),
    }
  }).slice(0, limit)

  // ── Load visits ──────────────────────────────────────────────
  const visitRows = await db.importStagedVisit.findMany({
    where: { workspaceId: WORKSPACE_ID, startedAt: { gte: new Date("2026-03-25") } },
    select: {
      id: true, googlePlaceId: true, startedAt: true, endedAt: true,
      placeName: true, aiEnrichment: true, resolvedPlaceId: true,
      latitude: true, longitude: true,
      resolvedPlace: { select: { name: true } },
    },
  })

  const visits: Visit[] = visitRows.map(v => {
    const enrich = (v.aiEnrichment ?? null) as { placeName?: string; category?: string; confidence?: number } | null
    return {
      id: v.id,
      googlePlaceId: v.googlePlaceId,
      startedAt: v.startedAt,
      endedAt: v.endedAt,
      localDate: localDate(v.startedAt, TZ),
      name: v.resolvedPlace?.name ?? v.placeName ?? enrich?.placeName ?? null,
      category: enrich?.category ?? null,
      enrichConfidence: enrich?.confidence ?? null,
      resolvedPlaceId: v.resolvedPlaceId,
      lat: v.latitude,
      lng: v.longitude,
    }
  })

  const visitsByDate = new Map<string, Visit[]>()
  for (const v of visits) {
    visitsByDate.set(v.localDate, [...(visitsByDate.get(v.localDate) ?? []), v])
  }

  console.log(`Transactions: ${txns.length} · Visits: ${visits.length} (${visitsByDate.size} days)`)

  // ── Geocode physical merchants (cached, Places Text Search) ──
  const geocodes = await geocodeMerchants(txns.filter(t => !t.online && !t.transfer))
  console.log(`Merchant geocodes: ${[...geocodes.values()].filter(Boolean).length}/${geocodes.size}`)

  // ── Deterministic pass ───────────────────────────────────────
  const results: MatchResult[] = []
  const needsAdjudication: { txn: Txn; candidates: Candidate[]; geocode: Geocode }[] = []

  for (const txn of txns) {
    if (txn.transfer) {
      results.push({ stagedId: txn.stagedId, merchant: txn.merchant, date: txn.date, band: "transfer" })
      continue
    }
    if (txn.online) {
      results.push({ stagedId: txn.stagedId, merchant: txn.merchant, date: txn.date, band: "online" })
      continue
    }

    // Same-day visits, plus the day before (card posting can shift a day)
    const dayCandidates = [
      ...(visitsByDate.get(txn.date) ?? []),
      ...(visitsByDate.get(shiftDate(txn.date, -1)) ?? []),
    ]
    if (dayCandidates.length === 0) {
      results.push({ stagedId: txn.stagedId, merchant: txn.merchant, date: txn.date, band: "unmatched", evidence: ["no visits on transaction date"] })
      continue
    }

    const geocode = geocodes.get(geoKey(txn)) ?? null
    const candidates: Candidate[] = dayCandidates.map(visit => {
      const nameSim = visit.name ? nameSimilarity(txn.merchantNorm, visit.name) : 0
      const catMatch = compatibleCategory(txn.category, visit.category)
      const distanceM = geocode && visit.lat !== null && visit.lng !== null
        ? haversineM(geocode.lat, geocode.lng, visit.lat, visit.lng)
        : null
      const score = combine(dayCandidates.length, nameSim, catMatch, visit.enrichConfidence, distanceM)
      return { visit, nameSim, catMatch, distanceM, score }
    }).sort((a, b) => b.score - a.score)

    const best = candidates[0]
    const merchantPlace = geocode ? { name: geocode.name, lat: geocode.lat, lng: geocode.lng, googlePlaceId: geocode.placeId } : null
    // A name-validated merchant geocode within plaza distance of a same-day
    // visit is conclusive: you were demonstrably at that location that day.
    const plazaMatch = merchantPlace && best.distanceM !== null && best.distanceM <= 250
    if (plazaMatch || best.score >= AUTO_THRESHOLD) {
      const confidence = plazaMatch
        ? Math.max(best.score, best.distanceM! <= 100 ? 0.95 : 0.9)
        : best.score
      results.push({
        stagedId: txn.stagedId, merchant: txn.merchant, date: txn.date,
        band: "auto",
        visitId: best.visit.id,
        googlePlaceId: merchantPlace?.googlePlaceId ?? best.visit.googlePlaceId,
        placeName: merchantPlace?.name ?? best.visit.name,
        merchantPlace,
        confidence: round(confidence),
        evidence: evidenceFor(best),
      })
    } else if (best.score >= ADJUDICATE_FLOOR) {
      needsAdjudication.push({ txn, candidates: candidates.slice(0, 5), geocode })
    } else {
      results.push({
        stagedId: txn.stagedId, merchant: txn.merchant, date: txn.date,
        band: "unmatched",
        evidence: [`best deterministic score ${round(best.score)} below floor`],
      })
    }
  }

  console.log(`Deterministic: ${results.filter(r => r.band === "auto").length} auto · ${needsAdjudication.length} to adjudicate · ${results.filter(r => r.band === "unmatched").length} unmatched · ${results.filter(r => r.band === "online").length} online · ${results.filter(r => r.band === "transfer").length} transfers`)

  // ── LLM adjudication ─────────────────────────────────────────
  if (needsAdjudication.length > 0) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk")
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    for (let i = 0; i < needsAdjudication.length; i += LLM_BATCH) {
      const batch = needsAdjudication.slice(i, i + LLM_BATCH)
      const adjudicated = await adjudicate(client, batch)
      results.push(...adjudicated)
      console.log(`  adjudicated ${Math.min(i + LLM_BATCH, needsAdjudication.length)}/${needsAdjudication.length}`)
    }
  }

  // ── Persist + report ─────────────────────────────────────────
  const summary = {
    total: results.length,
    auto: results.filter(r => r.band === "auto").length,
    adjudicatedMatched: results.filter(r => r.band === "adjudicated" && r.visitId).length,
    adjudicatedUnmatched: results.filter(r => r.band === "adjudicated" && !r.visitId).length,
    unmatched: results.filter(r => r.band === "unmatched").length,
    online: results.filter(r => r.band === "online").length,
    transfers: results.filter(r => r.band === "transfer").length,
  }

  if (!dryRun) {
    let written = 0
    for (const result of results) {
      const row = stagedRows.find(r => r.id === result.stagedId)
      if (!row) continue
      const meta = safeJson(row.metadata) as Record<string, unknown>
      meta.placeMatch = {
        band: result.band,
        visitId: result.visitId ?? null,
        googlePlaceId: result.googlePlaceId ?? null,
        placeName: result.placeName ?? null,
        merchantPlace: result.merchantPlace ?? null,
        confidence: result.confidence ?? null,
        evidence: result.evidence ?? [],
        reasoning: result.reasoning ?? null,
        matchedAt: new Date().toISOString(),
      }
      await db.stagedInteraction.update({
        where: { id: result.stagedId },
        data: { metadata: JSON.stringify(meta) },
      })
      written += 1
      if (written % 100 === 0) console.log(`  persisted ${written}…`)
    }
    console.log(`Persisted placeMatch on ${written} staged transactions`)
  }

  const reportPath = path.join(REPO_ROOT, "logs", `era-place-match-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify({ summary, results }, null, 2))
  console.log("\nSummary:", JSON.stringify(summary, null, 2))
  console.log(`Full report: ${reportPath}`)
}

// ── Adjudication ───────────────────────────────────────────────

async function adjudicate(
  client: InstanceType<typeof import("@anthropic-ai/sdk").default>,
  batch: { txn: Txn; candidates: Candidate[]; geocode: Geocode }[],
): Promise<MatchResult[]> {
  const payload = batch.map(({ txn, candidates }) => ({
    transactionId: txn.stagedId,
    merchant: txn.merchant,
    rawCity: txn.city,
    category: txn.category,
    amount: txn.amount,
    date: txn.date,
    candidates: candidates.map(c => ({
      visitId: c.visit.id,
      inferredPlaceName: c.visit.name,
      inferredCategory: c.visit.category,
      visitStart: c.visit.startedAt.toISOString(),
      visitEnd: c.visit.endedAt?.toISOString() ?? null,
      nameSimilarity: round(c.nameSim),
      merchantDistanceMeters: c.distanceM === null ? null : Math.round(c.distanceM),
      deterministicScore: round(c.score),
    })),
  }))

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [
      "You match credit-card transactions to physical place visits from a location timeline.",
      "Place names were inferred from coordinates by another model and may be wrong — weigh nameSimilarity accordingly.",
      "Card descriptors are truncated/mangled (e.g. 'SPROUTS MARKELAS VEGAS NV' = Sprouts Farmers Market, Las Vegas).",
      "For each transaction pick the single best candidate visit or null if none is plausible.",
      "confidence is the calibrated probability YOUR match is correct (0-1). Be honest: if two candidates are equally plausible, confidence cannot exceed 0.5.",
      "Respond with ONLY a JSON array: [{\"transactionId\", \"visitId\" | null, \"confidence\", \"reasoning\" (one short sentence)}]",
    ].join(" "),
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  })

  const text = response.content.find(b => b.type === "text")?.text ?? "[]"
  const parsed = extractJsonArray(text) as { transactionId: string; visitId: string | null; confidence: number; reasoning?: string }[]

  return batch.map(({ txn, candidates, geocode }) => {
    const verdict = parsed.find(p => p.transactionId === txn.stagedId)
    const chosen = verdict?.visitId ? candidates.find(c => c.visit.id === verdict.visitId) : undefined
    const merchantPlace = geocode ? { name: geocode.name, lat: geocode.lat, lng: geocode.lng, googlePlaceId: geocode.placeId } : null
    return {
      stagedId: txn.stagedId,
      merchant: txn.merchant,
      date: txn.date,
      band: "adjudicated" as const,
      visitId: chosen?.visit.id,
      googlePlaceId: (chosen ? merchantPlace?.googlePlaceId : null) ?? chosen?.visit.googlePlaceId ?? null,
      placeName: (chosen ? merchantPlace?.name : null) ?? chosen?.visit.name ?? null,
      merchantPlace: chosen ? merchantPlace : null,
      confidence: verdict ? round(Math.max(0, Math.min(1, verdict.confidence))) : 0,
      evidence: chosen ? evidenceFor(chosen) : ["adjudicator found no plausible candidate"],
      reasoning: verdict?.reasoning,
    }
  })
}

// ── Scoring ────────────────────────────────────────────────────

// Likelihood-ratio combination in log-odds space. Prior odds = 1/N candidates.
function combine(candidateCount: number, nameSim: number, catMatch: boolean | null, enrichConfidence: number | null, distanceM: number | null) {
  const priorOdds = 1 / Math.max(1, candidateCount)
  let logOdds = Math.log(priorOdds)

  // Name similarity vs the visit's resolved name — discounted by how much
  // we trust that name.
  const trust = enrichConfidence ?? 0.5
  if (nameSim >= 0.9) logOdds += Math.log(60) * trust
  else if (nameSim >= 0.75) logOdds += Math.log(12) * trust
  else if (nameSim >= 0.6) logOdds += Math.log(3) * trust
  else if (nameSim >= 0.4) logOdds += 0
  else logOdds += Math.log(0.6)

  // Geo proximity: merchant geocode vs visit coordinates. The strongest
  // signal for stores inside visited plazas (visit resolves to the mall,
  // card says the store).
  if (distanceM !== null) {
    if (distanceM <= 100) logOdds += Math.log(40)
    else if (distanceM <= 250) logOdds += Math.log(15)
    else if (distanceM <= 600) logOdds += Math.log(4)
    else if (distanceM <= 2000) logOdds += 0
    else logOdds += Math.log(0.25)
  }

  if (catMatch === true) logOdds += Math.log(3)
  else if (catMatch === false) logOdds += Math.log(0.4)

  const odds = Math.exp(logOdds)
  return odds / (1 + odds)
}

function evidenceFor(c: Candidate) {
  const parts = [`name similarity ${round(c.nameSim)} vs "${c.visit.name}"`]
  if (c.distanceM !== null) parts.push(`merchant geocode ${Math.round(c.distanceM)}m from visit`)
  if (c.catMatch === true) parts.push("category compatible")
  if (c.catMatch === false) parts.push("category mismatch")
  parts.push(`visit ${c.visit.startedAt.toISOString()}`)
  return parts
}

const CATEGORY_MAP: Record<string, string[]> = {
  "Groceries": ["grocery", "supermarket", "market", "food"],
  "Dining out": ["restaurant", "cafe", "bar", "food", "dining", "pizza", "coffee"],
  "Coffee and snacks": ["cafe", "coffee", "bakery", "food"],
  "Health and fitness": ["gym", "fitness", "spa", "health", "medical", "sports"],
  "Healthcare and pharmacy": ["pharmacy", "medical", "hospital", "health", "clinic"],
  "Vehicle expenses": ["gas", "fuel", "car", "auto", "parking"],
  "Shopping and gear": ["store", "retail", "shopping", "mall"],
  "Travel and vacation": ["hotel", "airport", "resort", "travel"],
  "Pets": ["pet", "veterinar"],
  "Ride shares": ["airport", "transit"],
}

function compatibleCategory(txnCat: string | null, visitCat: string | null): boolean | null {
  if (!txnCat || !visitCat) return null
  const keywords = CATEGORY_MAP[txnCat]
  if (!keywords) return null
  const v = visitCat.toLowerCase()
  return keywords.some(k => v.includes(k))
}

// ── Merchant geocoding (Places Text Search, disk-cached) ──────

function geoKey(txn: Txn) {
  return `${txn.merchantNorm}|${txn.city ?? "las vegas, nv"}`
}

async function geocodeMerchants(txns: Txn[]): Promise<Map<string, Geocode>> {
  const cache: Record<string, Geocode> = fs.existsSync(GEOCODE_CACHE_PATH)
    ? JSON.parse(fs.readFileSync(GEOCODE_CACHE_PATH, "utf8"))
    : {}
  const out = new Map<string, Geocode>()
  const unique = new Map<string, Txn>()
  for (const txn of txns) {
    if (!unique.has(geoKey(txn))) unique.set(geoKey(txn), txn)
  }

  let fetched = 0
  for (const [key, txn] of unique) {
    if (key in cache) {
      out.set(key, cache[key])
      continue
    }
    if (!PLACES_API_KEY) {
      out.set(key, null)
      continue
    }
    const query = `${txn.merchantNorm} ${txn.city ?? "Las Vegas, NV"}`
    const result = await textSearch(query)
    // Validate the geocode: the found business name must resemble the
    // merchant, otherwise Text Search matched something else entirely.
    const valid = result && nameSimilarity(txn.merchantNorm, result.name) >= 0.5 ? result : null
    cache[key] = valid
    out.set(key, valid)
    fetched += 1
    await new Promise(resolve => setTimeout(resolve, 120))
  }

  fs.mkdirSync(path.dirname(GEOCODE_CACHE_PATH), { recursive: true })
  fs.writeFileSync(GEOCODE_CACHE_PATH, JSON.stringify(cache, null, 2))
  if (fetched > 0) console.log(`  text-searched ${fetched} new merchants (rest cached)`)
  return out
}

async function textSearch(query: string): Promise<Geocode> {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_API_KEY!,
        "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.types",
      },
      body: JSON.stringify({ textQuery: query, pageSize: 1 }),
    })
    if (!res.ok) return null
    const data = await res.json() as { places?: { id?: string; displayName?: { text?: string }; location?: { latitude: number; longitude: number }; types?: string[] }[] }
    const place = data.places?.[0]
    if (!place?.displayName?.text || !place.location) return null
    return { name: place.displayName.text, lat: place.location.latitude, lng: place.location.longitude, types: place.types ?? [], placeId: place.id ?? null }
  } catch {
    return null
  }
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ── Text utils ─────────────────────────────────────────────────

function normalizeMerchant(description: string, raw: string) {
  let s = (description || raw).toLowerCase()
  s = s.replace(/^(gglpay|aplpay|tst\*?|sq \*|sp |fsp\*|ls )\s*/g, "")
  s = s.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
  return s
}

function parseCityState(raw: string): string | null {
  const m = raw.match(/([A-Za-z .]+?)\s+([A-Z]{2})\s*$/)
  return m ? `${m[1].trim()}, ${m[2]}` : null
}

const ONLINE_PATTERNS = [
  /\.com/i, /internet/i, /help\.uber/i, /web id/i, /ppd id/i, /autopay/i,
  /billpay/i, /e-payment/i, /online/i, /g\.co\//i, /plan fee/i,
]
const ONLINE_MERCHANTS = [
  "amazon", "apple", "linkedin", "youtube", "wix", "uber eats", "uber", "netflix",
  "spotify", "anthropic", "superhuman", "krisp", "public", "scholarshare", "turo",
  "notion", "ring", "nv energy", "fitness your way", "skyroam", "nationwide",
  "google", "openai", "github", "vercel", "vonage", "zoom", "dropbox",
]
// Categories that bill remotely even when a city appears in the descriptor
const REMOTE_CATEGORIES = ["Utilities", "Taxes and bank fees", "Stocks and investments", "Paychecks"]

function isOnline(raw: string, merchant: string, city: string | null, category?: string | null) {
  if (ONLINE_PATTERNS.some(p => p.test(raw))) return true
  const m = merchant.toLowerCase()
  if (ONLINE_MERCHANTS.some(k => m.startsWith(k))) return true
  if (category && REMOTE_CATEGORIES.includes(category)) return true
  // A physical card swipe virtually always carries a trailing CITY ST
  if (!city) return true
  return false
}

function nameSimilarity(a: string, b: string) {
  const bn = b.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
  if (!a || !bn) return 0
  // Token containment beats pure edit distance for truncated descriptors
  const aTokens = a.split(" ").filter(t => t.length > 2)
  const bTokens = new Set(bn.split(" ").filter(t => t.length > 2))
  const overlap = aTokens.filter(t => [...bTokens].some(bt => bt.startsWith(t.slice(0, 4)) || t.startsWith(bt.slice(0, 4)))).length
  const containment = aTokens.length ? overlap / aTokens.length : 0
  return Math.max(containment, jaroWinkler(a, bn))
}

function jaro(s1: string, s2: string) {
  if (s1 === s2) return 1
  const l1 = s1.length, l2 = s2.length
  if (!l1 || !l2) return 0
  const md = Math.max(Math.floor(Math.max(l1, l2) / 2) - 1, 0)
  const m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false)
  let matches = 0
  for (let i = 0; i < l1; i++) {
    for (let j = Math.max(0, i - md); j < Math.min(i + md + 1, l2); j++) {
      if (m2[j] || s1[i] !== s2[j]) continue
      m1[i] = true; m2[j] = true; matches++
      break
    }
  }
  if (!matches) return 0
  let t = 0, k = 0
  for (let i = 0; i < l1; i++) {
    if (!m1[i]) continue
    while (!m2[k]) k++
    if (s1[i] !== s2[k]) t++
    k++
  }
  return (matches / l1 + matches / l2 + (matches - t / 2) / matches) / 3
}

function jaroWinkler(a: string, b: string) {
  const score = jaro(a, b)
  let prefix = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++
    else break
  }
  return score + prefix * 0.1 * (1 - score)
}

// ── Date utils ─────────────────────────────────────────────────

function localDate(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d)
}

function shiftDate(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function safeJson(value: string | null) {
  if (!value) return {}
  try { return JSON.parse(value) } catch { return {} }
}

function extractJsonArray(text: string) {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end === -1) return []
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return [] }
}

function round(n: number) {
  return Math.round(n * 100) / 100
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
