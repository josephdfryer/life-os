#!/usr/bin/env tsx

import type { PrismaClient } from "@life-os/db"
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  parseExportZip,
  readZipEntryText,
  findLatestExportZip,
  type DailyRow,
  type WorkoutRow,
  type ParsedExport,
} from "./health/parse-export.ts"
import { HEALTH_METRIC_TAXONOMY, dailyRowToMetrics } from "./health/metrics.ts"
import {
  ensureStateDefinition,
  replaceStatesForSourceNoteInTransaction,
} from "@life-os/domain"
import { runRulesForTarget } from "@life-os/automation"

const require = createRequire(import.meta.url)
const dotenv = require("dotenv") as { config(options: { path: string; quiet?: boolean }): void }

loadEnv()

let db: PrismaClient

const WORKSPACE_ENTITY_TYPE = "Person"
const STATE_TYPE = "health_metric"
const SOURCE = "health-auto-export"
const DEFAULT_ZIP_DIR = path.join(
  os.homedir(),
  "Library/Mobile Documents/com~apple~CloudDocs/LifeOS",
)
const DEFAULT_PERSON_ID = process.env.HEALTH_SYNC_PERSON_ID ?? "cmr9gi8eb008104lek5io7qoa"

type Options = {
  zipPath: string | null
  zipDir: string
  dryRun: boolean
  personId: string
  limitDays: number | null
  skipWorkouts: boolean
  skipDaily: boolean
  verbose: boolean
}

async function main() {
  db = (await import("@life-os/db")).db
  const options = parseArgs(process.argv.slice(2))

  const zipPath = options.zipPath ?? findLatestExportZip(options.zipDir)
  if (!zipPath) {
    throw new Error(`No HealthAutoExport_*.zip found in ${options.zipDir}. Pass --zip <path> explicitly.`)
  }
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Zip not found: ${zipPath}`)
  }

  console.log(`[health-sync] Parsing ${zipPath}`)
  const parsed = await parseExportZip(zipPath)
  reportParse(parsed)

  if (options.dryRun) {
    console.log("[health-sync] --dry-run: no database writes performed.")
    await disconnectDb()
    return
  }

  const person = await db.person.findUnique({
    where: { id: options.personId },
    select: { id: true, workspaceId: true, first: true, last: true },
  })
  if (!person) {
    throw new Error(
      `No Person found with id "${options.personId}". Refusing to guess or auto-create a self Person — ` +
      "pass the correct id via --person-id."
    )
  }
  console.log(`[health-sync] Resolved self Person: ${person.first} ${person.last} (${person.id}, workspace ${person.workspaceId})`)

  const definitionIds = await ensureStateDefinitions(person.workspaceId)

  let daysProcessed = 0
  let statesWritten = 0
  if (!options.skipDaily) {
    const dailyRows = options.limitDays ? parsed.dailyRows.slice(-options.limitDays) : parsed.dailyRows
    for (const row of dailyRows) {
      const result = await syncDailyRow({
        row,
        workspaceId: person.workspaceId,
        entityId: person.id,
        definitionIds,
        zipFilename: parsed.zipFilename,
        verbose: options.verbose,
      })
      daysProcessed++
      statesWritten += result.statesWritten
    }
  }

  let workoutsCreated = 0
  let workoutsUpdated = 0
  let routesArchived = 0
  if (!options.skipWorkouts && parsed.workouts.length > 0) {
    const runNote = await db.note.create({
      data: {
        workspaceId: person.workspaceId,
        type: "import",
        timestamp: new Date(),
        content: `Health Auto Export sync: processed ${parsed.workouts.length} workout(s) from ${parsed.zipFilename}.`,
        metadata: JSON.stringify({ sourceMarker: `${SOURCE}:workout-run:${parsed.zipFilename}:${Date.now()}` }),
      },
      select: { id: true },
    })

    for (const workout of parsed.workouts) {
      const result = await syncWorkout({
        workout,
        workspaceId: person.workspaceId,
        runNoteId: runNote.id,
        parsed,
        verbose: options.verbose,
      })
      if (result.created) workoutsCreated++
      else workoutsUpdated++
      if (result.routeArchived) routesArchived++
    }
  }

  console.log(
    `[health-sync] Done. days=${daysProcessed} states=${statesWritten} workoutsCreated=${workoutsCreated} ` +
    `workoutsUpdated=${workoutsUpdated} routesArchived=${routesArchived}`
  )
  await disconnectDb()
}

function reportParse(parsed: ParsedExport) {
  console.log(
    `[health-sync] Parsed: ${parsed.dailyRows.length} daily row(s), ${parsed.workouts.length} workout(s) ` +
    `(${parsed.workoutDuplicatesCollapsed} exact-duplicate row(s) collapsed), ` +
    `${parsed.routeMatches.size}/${parsed.workouts.length} route(s) matched.`
  )
  if (parsed.sameMinuteCollisions.length > 0) {
    console.log(`[health-sync] WARNING: ${parsed.sameMinuteCollisions.length} same-type-same-minute workout collision(s) detected — verify these are distinct workouts, not near-duplicates:`)
    for (const collision of parsed.sameMinuteCollisions) {
      console.log(`  ${collision.key}: ${collision.sourceIds.join(", ")}`)
    }
  }
}

async function ensureStateDefinitions(workspaceId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const def of HEALTH_METRIC_TAXONOMY) {
    const row = await ensureStateDefinition({
      entityType: WORKSPACE_ENTITY_TYPE,
      type: STATE_TYPE,
      value: def.key,
      description: def.description,
    }, workspaceId)
    map.set(def.key, row.id)
  }
  return map
}

async function syncDailyRow(input: {
  row: DailyRow
  workspaceId: string
  entityId: string
  definitionIds: Map<string, string>
  zipFilename: string
  verbose: boolean
}): Promise<{ statesWritten: number }> {
  const { row, workspaceId, entityId, definitionIds, zipFilename } = input
  const sourceMarker = `${SOURCE}:day:${row.dayKey}`
  const metrics = dailyRowToMetrics(row.raw)

  const digest = metrics
    .map(m => `${m.key}=${m.value}`)
    .join(" ")
  const content = `Health Auto Export daily digest for ${row.dayKey}: ${digest || "(no populated metrics)"}`
  const metadataJson = JSON.stringify({ sourceMarker, zipFilename, raw: row.raw })

  const existingNote = await findNoteByMarker(workspaceId, sourceMarker)
  const note = existingNote
    ? await db.note.update({
      where: { id: existingNote.id },
      data: { content, metadata: metadataJson },
      select: { id: true },
    })
    : await db.note.create({
      data: {
        workspaceId,
        type: "import",
        timestamp: row.dayDate,
        content,
        metadata: metadataJson,
      },
      select: { id: true },
    })

  const actor = { type: "system" as const, label: "health-sync", workspaceId }
  const recorded = await db.$transaction(tx => replaceStatesForSourceNoteInTransaction(
    tx,
    note.id,
    metrics.map(metric => {
      const definitionId = definitionIds.get(metric.key)
      if (!definitionId) throw new Error(`No StateDefinition resolved for metric key "${metric.key}"`)
      return {
        entityType: WORKSPACE_ENTITY_TYPE,
        entityId,
        definitionId,
        severity: metric.value,
        source: SOURCE,
        recordedAt: row.dayDate,
      }
    }),
    workspaceId,
    actor,
  ))
  await Promise.all(recorded.map(({ state, definition }) => runRulesForTarget({
    trigger: "state.record",
    targetType: "state",
    targetId: state.id,
    payload: {
      stateId: state.id,
      entityType: state.entityType,
      entityId: state.entityId,
      definitionType: definition.type,
      definitionValue: definition.value,
      severity: state.severity,
    },
    actor,
  })))

  if (input.verbose) console.log(`[health-sync] ${row.dayKey}: ${metrics.length} metric(s)`)
  return { statesWritten: metrics.length }
}

async function findNoteByMarker(workspaceId: string, marker: string) {
  const candidates = await db.note.findMany({
    where: { workspaceId, type: "import", metadata: { contains: marker } },
    select: { id: true, metadata: true },
    take: 10,
  })
  return candidates.find(candidate => {
    try {
      return JSON.parse(candidate.metadata ?? "{}").sourceMarker === marker
    } catch {
      return false
    }
  }) ?? null
}

async function syncWorkout(input: {
  workout: WorkoutRow
  workspaceId: string
  runNoteId: string
  parsed: ParsedExport
  verbose: boolean
}): Promise<{ created: boolean; routeArchived: boolean }> {
  const { workout, workspaceId, runNoteId, parsed } = input
  const marker = `${SOURCE}-workout:${workout.sourceId}`

  let sourceFileId: string | null = null
  let routeArchived = false
  const routeName = parsed.routeMatches.get(workout.sourceId)
  if (routeName) {
    const existingFile = await db.importedFile.findFirst({
      where: { workspaceId, filename: routeName },
      select: { id: true },
    })
    if (existingFile) {
      sourceFileId = existingFile.id
    } else {
      const gpxContent = await readZipEntryText(parsed.zip, routeName)
      const file = await db.importedFile.create({
        data: {
          workspaceId,
          filename: routeName,
          format: "gpx",
          filePath: `zip:${parsed.zipFilename}:${routeName}`,
          sizeBytes: Buffer.byteLength(gpxContent, "utf8"),
          content: gpxContent,
        },
        select: { id: true },
      })
      sourceFileId = file.id
      routeArchived = true
    }
  }

  // Workouts are recorded as Events (world occurrences), not Interactions —
  // a solo workout isn't a relationship touchpoint with a Person, and folding
  // it in was drowning the real Interaction log (105 walks vs. 1 email).
  const eventMetadataJson = JSON.stringify({ sourceMarker: marker, sourceFileId })
  const existingEvent = await findEventByMarker(workspaceId, marker)
  const created = !existingEvent
  if (existingEvent) {
    await db.event.update({
      where: { id: existingEvent.id },
      data: {
        end: workout.end,
        metadata: eventMetadataJson,
        notes: summarizeWorkout(workout),
      },
      select: { id: true },
    })
  } else {
    await db.event.create({
      data: {
        workspaceId,
        name: `${workout.workoutType} workout`,
        type: "workout",
        start: workout.start,
        end: workout.end,
        timestamp: workout.start,
        notes: summarizeWorkout(workout),
        metadata: eventMetadataJson,
        sourceNoteId: runNoteId,
      },
      select: { id: true },
    })
  }

  if (input.verbose) console.log(`[health-sync] workout ${workout.sourceId}: ${created ? "created" : "updated"}${routeArchived ? " (+route)" : ""}`)
  return { created, routeArchived }
}

function summarizeWorkout(workout: WorkoutRow): string {
  const parts: string[] = []
  if (workout.distanceMiles) parts.push(`${workout.distanceMiles.toFixed(2)}mi`)
  parts.push(`${Math.round(workout.durationMinutes)}min`)
  if (workout.avgHeartRate) parts.push(`avg HR ${Math.round(workout.avgHeartRate)}bpm`)
  if (workout.activeEnergyKcal) parts.push(`${Math.round(workout.activeEnergyKcal)} kcal active`)
  return `${workout.workoutType}: ${parts.join(", ")}`
}

async function findEventByMarker(workspaceId: string, marker: string) {
  const candidates = await db.event.findMany({
    where: { workspaceId, type: "workout", metadata: { contains: marker } },
    select: { id: true, metadata: true },
    take: 10,
  })
  return candidates.find(candidate => {
    try {
      return JSON.parse(candidate.metadata ?? "{}").sourceMarker === marker
    } catch {
      return false
    }
  }) ?? null
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    zipPath: null,
    zipDir: DEFAULT_ZIP_DIR,
    dryRun: false,
    personId: DEFAULT_PERSON_ID,
    limitDays: null,
    skipWorkouts: false,
    skipDaily: false,
    verbose: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]
    if (arg === "--zip" && next) options.zipPath = expandHome(next), i++
    else if (arg === "--zip-dir" && next) options.zipDir = expandHome(next), i++
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--person-id" && next) options.personId = next, i++
    else if (arg === "--limit-days" && next) options.limitDays = Number(next), i++
    else if (arg === "--skip-workouts") options.skipWorkouts = true
    else if (arg === "--skip-daily") options.skipDaily = true
    else if (arg === "--verbose") options.verbose = true
    else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`Usage: npm run health:sync -- [options]

Options:
  --zip <path>        Path to a HealthAutoExport zip. Defaults to the newest
                       HealthAutoExport_*.zip in --zip-dir.
  --zip-dir <path>     Defaults to ~/Library/Mobile Documents/com~apple~CloudDocs/LifeOS
  --dry-run            Parse and print planned work. No database connection, no writes.
  --person-id <id>     Person to attach health data to. Defaults to $HEALTH_SYNC_PERSON_ID
                       or a built-in default.
  --limit-days <n>     Only process the most recent n daily rows (for testing).
  --skip-workouts      Only process the daily aggregate CSV.
  --skip-daily         Only process workouts.
  --verbose            Extra per-row/per-workout logging.
`)
}

function loadEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "packages/db/.env"),
    path.join(process.cwd(), "apps/persons/.env"),
    path.join(process.cwd(), "apps/persons/.env.local"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) dotenv.config({ path: candidate, quiet: true })
  }
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir()
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2))
  return value
}

async function disconnectDb() {
  if (db) await db.$disconnect()
}

main().catch(async error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  await disconnectDb()
  process.exit(1)
})
