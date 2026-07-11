#!/usr/bin/env tsx
// Resolves Google place IDs on staged timeline visits to exact business
// names via the Places API (New). Writes authoritative placeName /
// placeAddress columns and upgrades aiEnrichment so the finance matcher
// scores against real names instead of coordinate guesses.
//
// Usage: npx tsx scripts/era/resolve-place-ids.ts [--since 2026-03-25]

import fs from "node:fs"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")

for (const candidate of [
  path.join(REPO_ROOT, "apps/places/.env.local"),
  path.join(REPO_ROOT, "apps/places/.env"),
  path.join(REPO_ROOT, "apps/persons/.env"),
]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && (process.env[m[1]] === undefined || process.env[m[1]] === "")) process.env[m[1]] = m[2]
  }
}

const API_KEY = process.env.GOOGLE_PLACES_API_KEY
const DELAY_MS = 120

type PlaceDetails = { name: string; address: string | null; types: string[] }

async function main() {
  if (!API_KEY) throw new Error("GOOGLE_PLACES_API_KEY is not set")
  const sinceArg = process.argv.indexOf("--since")
  const since = new Date(sinceArg > -1 ? process.argv[sinceArg + 1] : "2026-03-25")

  const { db } = await import("@life-os/db")

  const visits = await db.importStagedVisit.findMany({
    where: {
      googlePlaceId: { not: null },
      placeName: null,
      startedAt: { gte: since },
    },
    select: { id: true, googlePlaceId: true },
  })

  const byPlaceId = new Map<string, string[]>()
  for (const visit of visits) {
    byPlaceId.set(visit.googlePlaceId!, [...(byPlaceId.get(visit.googlePlaceId!) ?? []), visit.id])
  }
  console.log(`Visits to resolve: ${visits.length} across ${byPlaceId.size} unique place IDs`)

  const cache = new Map<string, PlaceDetails | null>()
  let resolved = 0
  let failed = 0
  let index = 0

  for (const [placeId, visitIds] of byPlaceId) {
    index += 1
    let details = cache.get(placeId)
    if (details === undefined) {
      details = await fetchPlace(placeId)
      cache.set(placeId, details)
      await delay(DELAY_MS)
    }
    if (!details) {
      failed += 1
      continue
    }

    for (const visitId of visitIds) {
      const existing = await db.importStagedVisit.findUnique({
        where: { id: visitId },
        select: { aiEnrichment: true },
      })
      const previous = existing?.aiEnrichment ?? null
      await db.importStagedVisit.update({
        where: { id: visitId },
        data: {
          placeName: details.name,
          placeAddress: details.address,
          aiEnrichment: {
            placeName: details.name,
            // Join types so keyword category matching hits ("grocery_store"…)
            category: details.types.slice(0, 4).join(" "),
            confidence: 0.98,
            reasoning: "Resolved via Google Places API (New) place details",
            googleTypes: details.types,
            coordinateGuess: previous,
          },
        },
      })
      resolved += 1
    }
    if (index % 25 === 0) console.log(`  ${index}/${byPlaceId.size} place IDs…`)
  }

  console.log(`\nDone. Visits resolved: ${resolved} · place IDs failed: ${failed}`)
}

async function fetchPlace(placeId: string): Promise<PlaceDetails | null> {
  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=displayName,types,formattedAddress`,
      { headers: { "X-Goog-Api-Key": API_KEY! } },
    )
    if (!res.ok) {
      if (res.status !== 404) console.warn(`  place ${placeId}: HTTP ${res.status}`)
      return null
    }
    const data = await res.json() as { displayName?: { text?: string }; formattedAddress?: string; types?: string[] }
    if (!data.displayName?.text) return null
    return {
      name: data.displayName.text,
      address: data.formattedAddress ?? null,
      types: data.types ?? [],
    }
  } catch (error) {
    console.warn(`  place ${placeId}: ${error instanceof Error ? error.message : error}`)
    return null
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
