import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseDailyCsv,
  parseWorkoutsCsv,
  indexRoutes,
  matchRoutesToWorkouts,
  workoutMinuteKey,
} from "./parse-export.ts"

const WORKOUTS_HEADER = "Workout Type,Start,End,Duration,Active Energy (kcal),Resting Energy (kcal),Intensity (kcal/hr·kg),Max. Heart Rate (count/min),Avg. Heart Rate (count/min),Distance (mi),Max. Speed (mi/hr),Avg. Speed (mi/hr),Flights Climbed,Elevation Ascended (ft),Elevation Descended (ft),Step Count,Step Cadence (spm),Swimming Stroke Count,Swim Cadence (spm),Lap Length (yd),Swim Stroke Style,SWOLF Score,Water Salinity,Temperature (degF),Humidity (%),Location,"

test("parseDailyCsv: parses header/value rows and derives a UTC day key", () => {
  const csv = [
    "Date/Time,Active Energy (kcal),Step Count (count)",
    "2026-07-11 00:00:00,779.45,10448",
    "2026-07-12 00:00:00,625.32,7499",
  ].join("\n")

  const rows = parseDailyCsv(csv)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].dayKey, "2026-07-11")
  assert.equal(rows[0].dayDate.toISOString(), "2026-07-11T00:00:00.000Z")
  assert.equal(rows[0].raw["Active Energy (kcal)"], "779.45")
  assert.equal(rows[1].raw["Step Count (count)"], "7499")
})

test("parseDailyCsv: skips blank trailing lines", () => {
  const csv = "Date/Time,Active Energy (kcal)\n2026-07-11 00:00:00,779.45\n\n"
  const rows = parseDailyCsv(csv)
  assert.equal(rows.length, 1)
})

test("parseDailyCsv: throws on an unexpected quoted field rather than mis-parsing", () => {
  const csv = 'Date/Time,Notes\n2026-07-11 00:00:00,"has, a comma"\n'
  assert.throws(() => parseDailyCsv(csv))
})

test("parseWorkoutsCsv: byte-identical duplicate rows collapse to one workout", () => {
  const dupLine = "Walk,2026-05-22 20:46,2026-05-22 20:56,00:10:00,38.02851867675781,20.145153466260094,0.0,110.0,101.97160084100116,0.35753872987918284,0.0,0.0,0.0,0.0,0.0,801.8353462430024,80.18353462430024,0.0,0.0,0.0,,0.0,,0.0,0.0,,"
  const csv = [WORKOUTS_HEADER, dupLine, dupLine].join("\n")

  const { workouts, duplicatesCollapsed } = parseWorkoutsCsv(csv)
  assert.equal(workouts.length, 1)
  assert.equal(duplicatesCollapsed, 1)
})

test("parseWorkoutsCsv: two real workouts starting in the same clock-minute stay distinct", () => {
  // Real edge case from a HealthAutoExport zip: same Type+Start-minute, different End/stats.
  const rowA = "Walk,2026-05-16 12:47,2026-05-16 13:07,00:20:00,66.27900695800781,37.640000000000015,0.0,103.0,93.8625905261335,0.22262497060323985,0.0,0.0,0.0,0.0,0.0,1261.5445460916433,63.077227304582166,0.0,0.0,0.0,,0.0,,0.0,0.0,,"
  const rowB = "Walk,2026-05-16 12:47,2026-05-16 13:05,00:18:00,60.69670486450195,34.184077115856105,0.0,103.0,93.93474970739979,0.22262497060323985,0.0,0.0,0.0,0.0,0.0,1226.1447993398679,68.11915551888154,0.0,0.0,0.0,,0.0,,0.0,0.0,,"
  const csv = [WORKOUTS_HEADER, rowA, rowB].join("\n")

  const { workouts, duplicatesCollapsed, sameMinuteCollisions } = parseWorkoutsCsv(csv)
  assert.equal(workouts.length, 2)
  assert.equal(duplicatesCollapsed, 0)
  assert.equal(sameMinuteCollisions.length, 1)
  assert.equal(sameMinuteCollisions[0].sourceIds.length, 2)
  assert.notEqual(workouts[0].sourceId, workouts[1].sourceId)
})

test("parseWorkoutsCsv: parses duration, energy, and heart rate fields", () => {
  const row = "Outdoor Cycling,2026-05-22 05:32,2026-05-22 05:41,00:09:12,24.11,16.85,3.87,107.0,96.52,0.97,11.4,6.97,0.0,0.0,0.0,218.6,23.7,0.0,0.0,0.0,,0.0,,0.0,0.0,Outdoor,"
  const csv = [WORKOUTS_HEADER, row].join("\n")

  const { workouts } = parseWorkoutsCsv(csv)
  assert.equal(workouts.length, 1)
  const w = workouts[0]
  assert.equal(w.workoutType, "Outdoor Cycling")
  assert.ok(Math.abs(w.durationMinutes - 9.2) < 0.01)
  assert.equal(w.activeEnergyKcal, 24.11)
  assert.equal(w.maxHeartRate, 107)
  assert.equal(w.avgHeartRate, 96.52)
})

test("indexRoutes + matchRoutesToWorkouts: matches a GPX route to its workout by type+start-minute", () => {
  const row = "Walk,2026-07-10 20:21,2026-07-10 20:36,00:15:00,45.85,18.83,0.0,121.0,93.27,0.03,0.0,0.0,0.0,0.0,0.0,404.0,26.9,0.0,0.0,0.0,,0.0,,0.0,0.0,,"
  const csv = [WORKOUTS_HEADER, row].join("\n")
  const { workouts } = parseWorkoutsCsv(csv)

  const routes = indexRoutes([
    "Walk-Route-20260710_202100.gpx",
    "Outdoor Cycling-Route-20260522_053229.gpx",
    "not-a-route-file.gpx",
  ])
  assert.equal(routes.length, 2)

  const matches = matchRoutesToWorkouts(workouts, routes)
  assert.equal(matches.get(workouts[0].sourceId), "Walk-Route-20260710_202100.gpx")
})

test("matchRoutesToWorkouts: leaves workouts with no route unmatched", () => {
  const row = "Traditional Strength Training,2026-06-01 08:00,2026-06-01 08:30,00:30:00,100.0,20.0,0.0,110.0,90.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,,0.0,,0.0,0.0,,"
  const csv = [WORKOUTS_HEADER, row].join("\n")
  const { workouts } = parseWorkoutsCsv(csv)

  const matches = matchRoutesToWorkouts(workouts, [])
  assert.equal(matches.size, 0)
})

test("workoutMinuteKey: same type+minute produces the same key regardless of seconds", () => {
  const a = workoutMinuteKey("Walk", new Date("2026-07-10T20:21:00.000Z"))
  const b = workoutMinuteKey("Walk", new Date("2026-07-10T20:21:29.000Z"))
  assert.equal(a, b)
})
