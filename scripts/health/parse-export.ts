// Pure, DB-free parsing of a Health Auto Export zip archive.
// No imports from @life-os/db — safe to unit-test in isolation.

import JSZip from "jszip"
import fs from "node:fs"
import path from "node:path"

export type DailyRow = {
  dayKey: string // "YYYY-MM-DD"
  dayDate: Date // UTC midnight for that calendar day
  raw: Record<string, string>
}

export type WorkoutRow = {
  sourceId: string
  workoutType: string
  start: Date
  end: Date
  durationMinutes: number
  activeEnergyKcal: number | null
  restingEnergyKcal: number | null
  maxHeartRate: number | null
  avgHeartRate: number | null
  distanceMiles: number | null
  flightsClimbed: number | null
  stepCount: number | null
  raw: Record<string, string>
}

export type RouteEntry = { name: string; type: string; timestamp: Date }

export type ParsedExport = {
  zipFilename: string
  zip: JSZip
  dailyRows: DailyRow[]
  workouts: WorkoutRow[]
  workoutDuplicatesCollapsed: number
  sameMinuteCollisions: Array<{ key: string; sourceIds: string[] }>
  routeMatches: Map<string, string> // workout sourceId -> gpx entry name
}

// This export format never quotes fields (verified against a real export) —
// throw rather than silently mis-split if that ever changes.
function csvSplit(line: string): string[] {
  if (line.includes('"')) {
    throw new Error(`Unsupported quoted CSV field, parser does not handle quoting: ${line.slice(0, 100)}`)
  }
  return line.split(",")
}

function parseCsvText(text: string): string[][] {
  return text
    .split(/\r\n|\n/)
    .filter(line => line.trim().length > 0)
    .map(csvSplit)
}

export function parseDailyCsv(text: string): DailyRow[] {
  const [header, ...rows] = parseCsvText(text)
  return rows
    .filter(cols => cols.some(cell => cell.trim().length > 0))
    .map(cols => {
      const raw: Record<string, string> = {}
      header.forEach((h, i) => { raw[h] = (cols[i] ?? "").trim() })
      const dateTimeRaw = raw["Date/Time"] ?? ""
      const dayKey = dateTimeRaw.slice(0, 10)
      const [y, m, d] = dayKey.split("-").map(Number)
      const dayDate = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1))
      return { dayKey, dayDate, raw }
    })
}

function parseWorkoutDate(value: string): Date {
  // "YYYY-MM-DD HH:MM" — no timezone in the source data; treated as literal
  // UTC digits, consistent with parseDailyCsv's Date/Time handling.
  const [datePart, timePart] = value.trim().split(" ")
  const [y, m, d] = datePart.split("-").map(Number)
  const [hh, mm] = (timePart ?? "00:00").split(":").map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh || 0, mm || 0))
}

function parseDurationMinutes(value: string, start: Date, end: Date): number {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})$/)
  if (match) {
    const [, hh, mm, ss] = match
    return Number(hh) * 60 + Number(mm) + Number(ss) / 60
  }
  return Math.max(0, (end.getTime() - start.getTime()) / 60000)
}

function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

// Minute-precision key used both to build a workout's idempotent sourceId
// components and to match GPX route files to their parent workout.
export function workoutMinuteKey(type: string, date: Date): string {
  return `${slugify(type)}:${date.toISOString().slice(0, 16)}`
}

export function parseWorkoutsCsv(text: string): {
  workouts: WorkoutRow[]
  duplicatesCollapsed: number
  sameMinuteCollisions: Array<{ key: string; sourceIds: string[] }>
} {
  const [header, ...rows] = parseCsvText(text)
  const idx = (name: string) => header.indexOf(name)
  const iType = idx("Workout Type")
  const iStart = idx("Start")
  const iEnd = idx("End")
  const iDuration = idx("Duration")
  const iActiveEnergy = idx("Active Energy (kcal)")
  const iRestingEnergy = idx("Resting Energy (kcal)")
  const iMaxHR = idx("Max. Heart Rate (count/min)")
  const iAvgHR = idx("Avg. Heart Rate (count/min)")
  const iDistance = idx("Distance (mi)")
  const iFlights = idx("Flights Climbed")
  const iSteps = idx("Step Count")

  const workouts: WorkoutRow[] = []
  const seenSourceIds = new Set<string>()
  const minuteKeyToSourceIds = new Map<string, string[]>()
  let duplicatesCollapsed = 0

  for (const cols of rows) {
    if (!cols.some(cell => cell.trim())) continue
    const workoutType = (cols[iType] ?? "").trim()
    const startStr = (cols[iStart] ?? "").trim()
    const endStr = (cols[iEnd] ?? "").trim()
    if (!workoutType || !startStr || !endStr) continue

    // (type, start, end) is the dedupe key: byte-identical re-exported rows
    // collapse to one, while two real workouts that merely start in the same
    // clock-minute (different end times) stay distinct.
    const sourceId = `${slugify(workoutType)}-${startStr.replace(/\D/g, "")}-${endStr.replace(/\D/g, "")}`
    if (seenSourceIds.has(sourceId)) {
      duplicatesCollapsed++
      continue
    }
    seenSourceIds.add(sourceId)

    const start = parseWorkoutDate(startStr)
    const end = parseWorkoutDate(endStr)
    const raw: Record<string, string> = {}
    header.forEach((h, i) => { raw[h] = (cols[i] ?? "").trim() })

    workouts.push({
      sourceId,
      workoutType,
      start,
      end,
      durationMinutes: parseDurationMinutes(cols[iDuration] ?? "", start, end),
      activeEnergyKcal: num(cols[iActiveEnergy]),
      restingEnergyKcal: num(cols[iRestingEnergy]),
      maxHeartRate: num(cols[iMaxHR]),
      avgHeartRate: num(cols[iAvgHR]),
      distanceMiles: num(cols[iDistance]),
      flightsClimbed: num(cols[iFlights]),
      stepCount: num(cols[iSteps]),
      raw,
    })

    const minuteKey = workoutMinuteKey(workoutType, start)
    const existing = minuteKeyToSourceIds.get(minuteKey) ?? []
    existing.push(sourceId)
    minuteKeyToSourceIds.set(minuteKey, existing)
  }

  const sameMinuteCollisions = [...minuteKeyToSourceIds.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, sourceIds]) => ({ key, sourceIds }))

  return { workouts, duplicatesCollapsed, sameMinuteCollisions }
}

const GPX_ROUTE_RE = /^(.+)-Route-(\d{8})_(\d{6})\.gpx$/

export function indexRoutes(gpxFilenames: string[]): RouteEntry[] {
  const entries: RouteEntry[] = []
  for (const name of gpxFilenames) {
    const match = name.match(GPX_ROUTE_RE)
    if (!match) continue
    const [, type, ymd, hms] = match
    const timestamp = new Date(Date.UTC(
      Number(ymd.slice(0, 4)),
      Number(ymd.slice(4, 6)) - 1,
      Number(ymd.slice(6, 8)),
      Number(hms.slice(0, 2)),
      Number(hms.slice(2, 4)),
    ))
    entries.push({ name, type, timestamp })
  }
  return entries
}

export function matchRoutesToWorkouts(workouts: WorkoutRow[], routes: RouteEntry[]): Map<string, string> {
  const byMinuteKey = new Map<string, RouteEntry[]>()
  for (const route of routes) {
    const key = workoutMinuteKey(route.type, route.timestamp)
    const existing = byMinuteKey.get(key) ?? []
    existing.push(route)
    byMinuteKey.set(key, existing)
  }

  const matches = new Map<string, string>()
  for (const workout of workouts) {
    const key = workoutMinuteKey(workout.workoutType, workout.start)
    const candidates = byMinuteKey.get(key)
    if (candidates && candidates.length > 0) matches.set(workout.sourceId, candidates[0].name)
  }
  return matches
}

export async function parseExportZip(zipPath: string): Promise<ParsedExport> {
  const buffer = fs.readFileSync(zipPath)
  const zip = await JSZip.loadAsync(buffer)
  const filenames = Object.keys(zip.files)

  const dailyCsvName = filenames.find(n => /^HealthAutoExport-.*\.csv$/.test(n))
  if (!dailyCsvName) throw new Error("No HealthAutoExport-*.csv aggregate file found in zip")
  const dailyText = await zip.files[dailyCsvName].async("text")
  const dailyRows = parseDailyCsv(dailyText)

  const workoutsCsvName = filenames.find(n => /^Workouts-.*\.csv$/.test(n))
  let workouts: WorkoutRow[] = []
  let workoutDuplicatesCollapsed = 0
  let sameMinuteCollisions: Array<{ key: string; sourceIds: string[] }> = []
  if (workoutsCsvName) {
    const workoutsText = await zip.files[workoutsCsvName].async("text")
    const parsed = parseWorkoutsCsv(workoutsText)
    workouts = parsed.workouts
    workoutDuplicatesCollapsed = parsed.duplicatesCollapsed
    sameMinuteCollisions = parsed.sameMinuteCollisions
  }

  const gpxNames = filenames.filter(n => n.endsWith(".gpx"))
  const routes = indexRoutes(gpxNames)
  const routeMatches = matchRoutesToWorkouts(workouts, routes)

  return {
    zipFilename: path.basename(zipPath),
    zip,
    dailyRows,
    workouts,
    workoutDuplicatesCollapsed,
    sameMinuteCollisions,
    routeMatches,
  }
}

export async function readZipEntryText(zip: JSZip, name: string): Promise<string> {
  const entry = zip.files[name]
  if (!entry) throw new Error(`Zip entry not found: ${name}`)
  return entry.async("text")
}

export function findLatestExportZip(dir: string): string | null {
  if (!fs.existsSync(dir)) return null
  const candidates = fs.readdirSync(dir)
    .filter(name => /^HealthAutoExport_\d+\.zip$/.test(name))
    .sort()
  if (candidates.length === 0) return null
  return path.join(dir, candidates[candidates.length - 1])
}
