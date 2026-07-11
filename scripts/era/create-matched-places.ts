#!/usr/bin/env tsx
// Creates Place records from finance placeMatch results. Each matched
// transaction's merchantPlace (name + coords + Google place ID from the
// matcher's validated geocode) becomes a real Place node, deduped by
// googlePlaceId. Idempotent.
//
// Usage: npx tsx scripts/era/create-matched-places.ts

import fs from "node:fs"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
for (const line of fs.readFileSync(path.join(REPO_ROOT, "apps/persons/.env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}

const WORKSPACE_ID = "default-workspace"

async function main() {
  const { db } = await import("@life-os/db")

  const staged = await db.stagedInteraction.findMany({
    where: { workspaceId: WORKSPACE_ID, source: "era" },
    select: { id: true, metadata: true },
  })

  type MerchantPlace = { name: string; lat: number; lng: number; googlePlaceId: string | null }
  const byGoogleId = new Map<string, MerchantPlace>()
  let matchedTxns = 0
  for (const row of staged) {
    const meta = safeJson(row.metadata) as { placeMatch?: { band?: string; merchantPlace?: MerchantPlace | null } }
    const match = meta.placeMatch
    if (!match || !match.merchantPlace || !["auto", "adjudicated"].includes(match.band ?? "")) continue
    const mp = match.merchantPlace
    if (!mp.googlePlaceId) continue
    matchedTxns += 1
    if (!byGoogleId.has(mp.googlePlaceId)) byGoogleId.set(mp.googlePlaceId, mp)
  }
  console.log(`Matched transactions with merchant places: ${matchedTxns} → ${byGoogleId.size} unique places`)

  let created = 0
  let existing = 0
  for (const [googlePlaceId, mp] of byGoogleId) {
    const found = await db.place.findUnique({ where: { googlePlaceId }, select: { id: true } })
    if (found) {
      existing += 1
      continue
    }
    await db.place.create({
      data: {
        workspaceId: WORKSPACE_ID,
        name: mp.name,
        googlePlaceId,
        coordinates: JSON.stringify({ latitude: mp.lat, longitude: mp.lng }),
        type: "business",
      },
    })
    created += 1
    console.log(`  + ${mp.name}`)
  }

  console.log(`\nDone. Places created: ${created} · already existed: ${existing}`)
}

function safeJson(value: string | null) {
  if (!value) return {}
  try { return JSON.parse(value) } catch { return {} }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
