#!/usr/bin/env tsx
// Resolve transactions to the storefront where they happened.
//
// Part A of docs/FINANCE_INTERACTION_MODEL_PLAN.md's place ladder, and the
// counterpart to link-merchant-groups.ts: the merchant is a Group, the specific
// branch is a Place, and PlaceGroup joins them as `corporate_parent`.
//
// Only transactions whose raw processor text ends in a city we recognise are
// considered — see lib/locality.ts for why guessing is refused.
//
//   npx tsx scripts/era/resolve-merchant-places.ts --dry-run
//   npx tsx scripts/era/resolve-merchant-places.ts --limit 20
//   npx tsx scripts/era/resolve-merchant-places.ts
//
// Costs one Places Text Search per distinct merchant+city, not per transaction.
// Results (including misses) are cached on disk so a re-run is free.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseLocality, placesQuery, namesPlausiblyMatch, SEED_CITIES, type Locality } from "./lib/locality"
import { merchantKey, isNonMerchant, normalizeMerchantName } from "./lib/merchant"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
for (const candidate of [path.join(REPO_ROOT, ".env"), path.join(REPO_ROOT, "apps/persons/.env")]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const WORKSPACE_ID = "default-workspace"
const DRY_RUN = process.argv.includes("--dry-run")
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit")
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity
})()
const CACHE_PATH = path.join(os.homedir(), ".life-os/places-merchant-cache.json")
const PLACES_URL = "https://places.googleapis.com/v1/places:searchText"

/**
 * Types that mean a consumer walked in. A charge from OpenAI resolves to a real
 * San Francisco address, but nobody visited it — linking that as "where this
 * happened" would be false. Corporate addresses land as `suggested` instead.
 */
const STOREFRONT_TYPES = new Set([
  "restaurant", "cafe", "bar", "bakery", "meal_takeaway", "meal_delivery", "food",
  "supermarket", "grocery_store", "convenience_store", "farmers_market",
  "shopping_mall", "department_store", "gas_station", "car_repair", "car_wash",
  "parking", "parking_lot", "parking_garage", "car_rental", "car_dealer",
  "gym", "fitness_center", "spa", "hair_care", "beauty_salon",
  "pharmacy", "drugstore", "doctor", "dentist", "hospital", "medical_clinic",
  "medical_center", "veterinary_care", "health",
  "lodging", "hotel", "resort_hotel", "motel", "casino",
  "movie_theater", "amusement_park", "tourist_attraction", "museum", "art_museum",
  "park", "zoo", "stadium", "bank", "atm", "post_office", "library",
  "airport", "international_airport", "train_station", "transit_station",
])

/**
 * Google's taxonomy is granular — "japanese_restaurant", "bagel_shop",
 * "toy_store" — so an exact allow-list would miss most real storefronts.
 * These suffixes catch the long tail without admitting corporate addresses.
 */
const STOREFRONT_SUFFIXES = /_(restaurant|store|shop|salon|market|bar|cafe|center|stand)$/

function isStorefrontType(types: string[]): boolean {
  return types.some(type => STOREFRONT_TYPES.has(type) || STOREFRONT_SUFFIXES.test(type))
}

type PlaceHit = {
  id: string
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  types: string[]
}

type CacheEntry = { hit: PlaceHit | null; at: string }

async function main() {
  const { db, attachContext } = await import("@life-os/db")
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey && !DRY_RUN) throw new Error("GOOGLE_PLACES_API_KEY is not set")

  console.log(DRY_RUN ? "DRY RUN — no API calls, no writes\n" : "LIVE RUN\n")

  // Cities already in the graph extend the seed list, so coverage grows with it.
  const cityPlaces = await db.place.findMany({
    where: { workspaceId: WORKSPACE_ID, type: { in: ["city", "locality"] } },
    select: { name: true },
  })
  const cities = new Set<string>([...SEED_CITIES, ...cityPlaces.map(p => p.name.toUpperCase())])

  const rows = await db.interaction.findMany({
    where: { workspaceId: WORKSPACE_ID, type: "financial", placeId: null, merchantName: { not: null } },
    select: { id: true, merchantName: true, metadata: true },
  })

  type Bucket = { query: string; merchant: string; locality: Locality; key: string; interactionIds: string[] }
  const buckets = new Map<string, Bucket>()
  for (const row of rows) {
    const name = row.merchantName!
    if (isNonMerchant(name)) continue
    let raw: string | null = null
    try { raw = JSON.parse(row.metadata ?? "{}").rawDescription ?? null } catch { /* no metadata */ }
    const locality = parseLocality(raw, cities)
    if (!locality) continue

    const merchant = normalizeMerchantName(name)
    const key = `${merchantKey(name)}|${locality.city}|${locality.state}`
    const bucket = buckets.get(key)
      ?? { query: placesQuery(merchant, locality), merchant, locality, key, interactionIds: [] }
    bucket.interactionIds.push(row.id)
    buckets.set(key, bucket)
  }

  const work = [...buckets.values()].slice(0, LIMIT)
  console.log(`unplaced transactions:     ${rows.length}`)
  console.log(`localisable:               ${[...buckets.values()].reduce((s, b) => s + b.interactionIds.length, 0)}`)
  console.log(`distinct merchant+city:    ${buckets.size}  (processing ${work.length})\n`)

  if (DRY_RUN) {
    for (const bucket of work.slice(0, 15)) {
      console.log(`  ${String(bucket.interactionIds.length).padStart(3)}x  ${bucket.query}`)
    }
    return
  }

  const cache = loadCache()
  const stats = { called: 0, cached: 0, storefront: 0, suggested: 0, unverified: 0, missed: 0, linked: 0, placesCreated: 0 }

  for (const bucket of work) {
    let entry = cache[bucket.query]
    if (entry) {
      stats.cached += 1
    } else {
      entry = { hit: await searchPlace(apiKey!, bucket.query), at: new Date().toISOString() }
      cache[bucket.query] = entry
      stats.called += 1
      saveCache(cache)
      await new Promise(resolve => setTimeout(resolve, 120)) // stay polite
    }

    if (!entry.hit) {
      stats.missed += 1
      continue
    }

    // Two independent gates. The type test asks "is this somewhere a customer
    // walks into"; the name test asks "is this even the business we asked
    // about". A garbled descriptor passes the first and fails the second.
    const isStorefront = isStorefrontType(entry.hit.types)
    const nameVerified = namesPlausiblyMatch(bucket.merchant, entry.hit.name)
    const trusted = isStorefront && nameVerified
    const band = trusted ? "auto" : "suggested"
    if (trusted) stats.storefront += 1
    else if (!nameVerified) stats.unverified += 1
    else stats.suggested += 1

    const place = await upsertPlace(db, entry.hit, bucket.locality)
    if (place.created) stats.placesCreated += 1

    for (const interactionId of bucket.interactionIds) {
      // Only a storefront becomes the interaction's canonical placeId. A
      // corporate address is recorded as evidence, not as where you were.
      if (trusted) {
        await db.interaction.update({ where: { id: interactionId }, data: { placeId: place.id } })
      }
      await attachContext(db, {
        interactionId,
        workspaceId: WORKSPACE_ID,
        entityType: "Place",
        entityId: place.id,
        role: "location",
        band,
        source: "merchant-places",
        confidence: trusted ? 0.9 : nameVerified ? 0.5 : 0.25,
        evidence: {
          query: bucket.query,
          googlePlaceId: entry.hit.id,
          resolvedName: entry.hit.name,
          types: entry.hit.types.slice(0, 6),
          reason: trusted
            ? "consumer-facing place type and the name matches"
            : !nameVerified
              ? "resolved name does not correspond to the descriptor"
              : "no storefront type — likely a corporate address",
        },
      })
      stats.linked += 1
    }

    // The branch belongs to the merchant: Place -> Group as corporate_parent.
    // Only for trusted matches; a wrong storefront must not inherit a brand.
    if (trusted) await linkPlaceToMerchantGroup(db, place.id, bucket.interactionIds[0])
  }

  console.log(`\nResult`)
  console.log(`  API calls          ${stats.called}   (cache hits ${stats.cached})`)
  console.log(`  storefronts        ${stats.storefront}`)
  console.log(`  corporate/other    ${stats.suggested}  (suggested; placeId left null)`)
  console.log(`  name mismatch      ${stats.unverified}  (suggested; placeId left null)`)
  console.log(`  no match           ${stats.missed}`)
  console.log(`  Places created     ${stats.placesCreated}`)
  console.log(`  interactions linked ${stats.linked}`)
}

async function searchPlace(apiKey: string, query: string): Promise<PlaceHit | null> {
  const response = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    console.warn(`  ! Places HTTP ${response.status} for "${query}": ${(await response.text()).slice(0, 160)}`)
    return null
  }
  const body = await response.json() as { places?: { id: string; displayName?: { text: string }; formattedAddress?: string; location?: { latitude: number; longitude: number }; types?: string[] }[] }
  const place = body.places?.[0]
  if (!place) return null
  return {
    id: place.id,
    name: place.displayName?.text ?? query,
    address: place.formattedAddress ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    types: place.types ?? [],
  }
}

async function upsertPlace(db: typeof import("@life-os/db").db, hit: PlaceHit, locality: Locality) {
  const existing = await db.place.findFirst({
    where: { workspaceId: WORKSPACE_ID, googlePlaceId: hit.id },
    select: { id: true },
  })
  if (existing) return { id: existing.id, created: false }

  const place = await db.place.create({
    data: {
      workspaceId: WORKSPACE_ID,
      name: hit.name,
      // Mirror how the Places app stores Google results: primary type on
      // `type`, coordinates as a JSON blob.
      type: hit.types[0] ?? "business",
      address: hit.address,
      googlePlaceId: hit.id,
      coordinates: hit.lat !== null && hit.lng !== null
        ? JSON.stringify({ latitude: hit.lat, longitude: hit.lng })
        : null,
    },
    select: { id: true },
  })
  return { id: place.id, created: true }
}

/**
 * A storefront belongs to its merchant. Reuse the counterparty Group already
 * attached to the transaction rather than re-deriving the merchant identity.
 */
async function linkPlaceToMerchantGroup(db: typeof import("@life-os/db").db, placeId: string, sampleInteractionId: string) {
  const edge = await db.interactionParticipant.findFirst({
    where: { interactionId: sampleInteractionId, entityType: "Group", role: "counterparty" },
    select: { entityId: true },
  })
  if (!edge) return
  const existing = await db.placeGroup.findFirst({
    where: { placeId, groupId: edge.entityId },
    select: { id: true },
  })
  if (existing) return
  await db.placeGroup.create({
    data: { placeId, groupId: edge.entityId, relationshipType: "corporate_parent" },
  })
}

function loadCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as Record<string, CacheEntry>
  } catch {
    return {}
  }
}

function saveCache(cache: Record<string, CacheEntry>) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
