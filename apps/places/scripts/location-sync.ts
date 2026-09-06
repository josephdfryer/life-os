#!/usr/bin/env tsx
// Turns a raw GPS ping log (written by an iOS Shortcuts automation) into
// visits and feeds them through the existing Google-Maps-shaped import
// pipeline (createImportJob) — no new business logic for place matching,
// confidence thresholds, or event creation; this only does the clustering
// step Google's own Timeline export already does on-device.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const dotenv = require("dotenv") as { config(options: { path: string; quiet?: boolean }): void }
loadEnv()

const DEFAULT_PING_LOG = path.join(
  os.homedir(),
  "Library/Mobile Documents/com~apple~CloudDocs/LifeOS/Location/pings.jsonl"
)
const STATE_PATH = path.join(os.homedir(), ".life-os/location-sync-state.json")
const WORKSPACE_ID = process.env.LOCATION_SYNC_WORKSPACE_ID ?? "default-workspace"

// Clustering thresholds — a visit is a run of pings that stay within RADIUS_METERS
// of each other; a gap in time or a jump beyond the radius ends it.
const RADIUS_METERS = 150
const MAX_GAP_MINUTES = 180
const MIN_VISIT_MINUTES = 5
const MIN_PINGS_PER_VISIT = 2

type Ping = { lat: number; lng: number; timestamp: Date }

type Cluster = {
  pings: Ping[]
  centroidLat: number
  centroidLng: number
}

type Options = { dryRun: boolean; pingLog: string }

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (!fs.existsSync(options.pingLog)) {
    console.log(`[location-sync] No ping log at ${options.pingLog} — nothing to do.`)
    return
  }

  const state = readState()
  const since = state.processedThroughTimestamp ? new Date(state.processedThroughTimestamp) : null

  const allPings = readPings(options.pingLog)
  const newPings = since ? allPings.filter(p => p.timestamp > since) : allPings
  console.log(`[location-sync] ${allPings.length} total pings, ${newPings.length} new since last run`)
  if (newPings.length === 0) return

  const visits = clusterPings(newPings)
  console.log(`[location-sync] Clustered into ${visits.length} visit(s) (min ${MIN_VISIT_MINUTES}min, min ${MIN_PINGS_PER_VISIT} pings)`)

  if (options.dryRun) {
    for (const v of visits) {
      console.log(`  ${v.startTime} → ${v.endTime} @ ${v.visit.topCandidate.placeLocation} (${v.visit.probability.toFixed(2)})`)
    }
    console.log("[location-sync] --dry-run: no import job created.")
    return
  }

  if (visits.length === 0) {
    updateState(newPings[newPings.length - 1].timestamp)
    return
  }

  const buffer = Buffer.from(JSON.stringify(visits))
  const filename = `location-sync-${new Date().toISOString().slice(0, 10)}.json`
  // Dynamic import, evaluated after loadEnv() above sets DATABASE_URL —
  // a static top-level import here would create the @life-os/db singleton
  // (transitively, via @/server/domain/import → @/lib/db) before env vars
  // are loaded, before the production connection string is available.
  const { createImportJob } = await import("@/server/domain/import")
  const job = await createImportJob({
    workspaceId: WORKSPACE_ID,
    filename,
    buffer,
    actor: { type: "system", label: "location-sync" },
  })
  console.log(
    `[location-sync] Import job ${job.id}: created=${job.createdRows} staged=${job.stagedRows} skipped=${job.skippedRows} errors=${job.errorRows}`
  )

  updateState(newPings[newPings.length - 1].timestamp)
}

function readPings(pingLog: string): Ping[] {
  const lines = fs.readFileSync(pingLog, "utf8").split("\n").filter(Boolean)
  const pings: Ping[] = []
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { lat?: number; lng?: number; timestamp?: string }
      if (typeof row.lat !== "number" || typeof row.lng !== "number" || !row.timestamp) continue
      const timestamp = new Date(row.timestamp)
      if (Number.isNaN(timestamp.getTime())) continue
      pings.push({ lat: row.lat, lng: row.lng, timestamp })
    } catch {
      // skip malformed line
    }
  }
  return pings.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}

function clusterPings(pings: Ping[]) {
  const clusters: Cluster[] = []
  let current: Cluster | null = null

  for (const ping of pings) {
    if (!current) {
      current = { pings: [ping], centroidLat: ping.lat, centroidLng: ping.lng }
      continue
    }
    const last = current.pings[current.pings.length - 1]
    const gapMinutes = (ping.timestamp.getTime() - last.timestamp.getTime()) / 60000
    const distance = distanceMeters(current.centroidLat, current.centroidLng, ping.lat, ping.lng)

    if (gapMinutes > MAX_GAP_MINUTES || distance > RADIUS_METERS) {
      clusters.push(current)
      current = { pings: [ping], centroidLat: ping.lat, centroidLng: ping.lng }
      continue
    }

    current.pings.push(ping)
    current.centroidLat = average(current.pings.map(p => p.lat))
    current.centroidLng = average(current.pings.map(p => p.lng))
  }
  if (current) clusters.push(current)

  return clusters
    .filter(c => {
      if (c.pings.length < MIN_PINGS_PER_VISIT) return false
      const durationMinutes =
        (c.pings[c.pings.length - 1].timestamp.getTime() - c.pings[0].timestamp.getTime()) / 60000
      return durationMinutes >= MIN_VISIT_MINUTES
    })
    .map(c => {
      const start = c.pings[0].timestamp
      const end = c.pings[c.pings.length - 1].timestamp
      // Simple density-based confidence — more pings over the visit window
      // reads as a more confidently-real stop, not a GPS glitch.
      const probability = Math.min(0.95, 0.5 + c.pings.length * 0.03)
      return {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        visit: {
          probability,
          topCandidate: {
            placeLocation: `geo:${c.centroidLat},${c.centroidLng}`,
          },
        },
      }
    })
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6_371_000
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

type SyncState = { processedThroughTimestamp?: string }

function readState(): SyncState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as SyncState
  } catch {
    return {}
  }
}

function updateState(through: Date) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, `${JSON.stringify({ processedThroughTimestamp: through.toISOString() }, null, 2)}\n`)
}

function parseArgs(args: string[]): Options {
  const options: Options = { dryRun: false, pingLog: DEFAULT_PING_LOG }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") options.dryRun = true
    else if (args[i] === "--ping-log" && args[i + 1]) { options.pingLog = args[i + 1]; i++ }
  }
  return options
}

function loadEnv() {
  // Resolve relative to this file, not process.cwd() — a launchd job's
  // WorkingDirectory may be the repo root, not apps/places.
  const appDir = path.resolve(import.meta.dirname, "..")
  const candidates = [path.join(appDir, ".env"), path.join(appDir, ".env.local")]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) dotenv.config({ path: candidate, quiet: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
