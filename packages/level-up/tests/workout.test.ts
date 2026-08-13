import assert from "node:assert/strict"
import test from "node:test"
import {
  bestE1RMKg,
  e1rmTrend,
  effectiveLoadKg,
  epleyE1RM,
  sparklinePath,
  topSetKg,
  totalDurationSec,
  totalVolumeKg,
  type SetRecord,
} from "../domain/metrics"
import { SEED_EXERCISES, SEED_PROGRAM, resolveSubstitution } from "../domain/seed-program"

function set(overrides: Partial<SetRecord> = {}): SetRecord {
  return {
    loadKg: 100,
    reps: 5,
    durationSec: null,
    isBodyweight: false,
    bodyweightKg: 90,
    performedAt: new Date("2026-07-28T18:00:00.000Z"),
    ...overrides,
  }
}

// ── Derived metrics ──

test("Epley matches the ratings engine's e1RM", () => {
  assert.equal(epleyE1RM(100, 5), 100 * (1 + 5 / 30))
  assert.equal(epleyE1RM(100, 0), 0)
  assert.equal(epleyE1RM(0, 5), 0)
})

test("a bodyweight set loads the body plus anything added", () => {
  assert.equal(effectiveLoadKg({ loadKg: 10, isBodyweight: true, bodyweightKg: 90 }), 100)
  assert.equal(effectiveLoadKg({ loadKg: 0, isBodyweight: true, bodyweightKg: 90 }), 90)
  assert.equal(effectiveLoadKg({ loadKg: 100, isBodyweight: false, bodyweightKg: 90 }), 100)
})

test("timed sets contribute duration, not volume", () => {
  const sets = [set(), set({ durationSec: 45, reps: 1, loadKg: 20 })]
  assert.equal(totalVolumeKg(sets), 500)
  assert.equal(totalDurationSec(sets), 45)
})

test("top set and best e1RM ignore timed work", () => {
  const sets = [set({ loadKg: 100 }), set({ loadKg: 140, reps: 2 }), set({ durationSec: 60 })]
  assert.equal(topSetKg(sets), 140)
  assert.equal(bestE1RMKg(sets), epleyE1RM(140, 2))
  assert.equal(topSetKg([set({ durationSec: 60 })]), null)
})

test("the trend keeps one best point per day, ascending", () => {
  const sets = [
    set({ loadKg: 100, reps: 5, performedAt: new Date("2026-07-20T18:00:00.000Z") }),
    set({ loadKg: 120, reps: 5, performedAt: new Date("2026-07-20T19:00:00.000Z") }),
    set({ loadKg: 110, reps: 5, performedAt: new Date("2026-07-27T18:00:00.000Z") }),
  ]
  const trend = e1rmTrend(sets, "America/Los_Angeles")
  assert.deepEqual(trend.map(point => point.day), ["2026-07-20", "2026-07-27"])
  assert.equal(trend[0].valueKg, epleyE1RM(120, 5))
})

test("a sparkline needs two points before it claims a direction", () => {
  assert.equal(sparklinePath([{ day: "2026-07-20", valueKg: 100 }], 100, 20), null)
  const path = sparklinePath(
    [{ day: "2026-07-20", valueKg: 100 }, { day: "2026-07-27", valueKg: 120 }],
    100,
    20,
  )
  // Rising values must fall in SVG space, where y grows downward.
  assert.equal(path, "M0.00,20.00 L100.00,0.00")
})

// ── The program ──

test("every seeded substitute and catalog reference resolves", () => {
  const keys = new Set(SEED_EXERCISES.map(exercise => exercise.key))
  for (const exercise of SEED_EXERCISES) {
    if (exercise.substituteKey) {
      assert.ok(keys.has(exercise.substituteKey), `${exercise.key} -> ${exercise.substituteKey}`)
    }
  }
  for (const day of SEED_PROGRAM.days) {
    for (const entry of day.entries) {
      assert.ok(keys.has(entry.exerciseKey), `${day.name} references ${entry.exerciseKey}`)
    }
  }
})

test("every exercise that stresses a joint offers a way out", () => {
  for (const exercise of SEED_EXERCISES) {
    const risky = exercise.jointLoad.includes("knee") || exercise.jointLoad.includes("lumbar")
    if (risky) assert.ok(exercise.substituteKey, `${exercise.key} has no substitute`)
  }
})

test("a substitute is offered only for the joint that is actually flaring", () => {
  const squat = SEED_EXERCISES.find(exercise => exercise.key === "back_squat")!
  const carry = SEED_EXERCISES.find(exercise => exercise.key === "farmer_carry")!
  const bench = SEED_EXERCISES.find(exercise => exercise.key === "bench_press")!

  assert.equal(resolveSubstitution(squat, { knee: true, lumbar: false }), "hip_thrust")
  assert.equal(resolveSubstitution(squat, { knee: false, lumbar: false }), null)
  // A knee flare must not quietly swap a movement the knee has nothing to do with.
  assert.equal(resolveSubstitution(carry, { knee: true, lumbar: false }), null)
  assert.equal(resolveSubstitution(carry, { knee: false, lumbar: true }), "dead_bug")
  assert.equal(resolveSubstitution(bench, { knee: true, lumbar: true }), null)
})

test("the program is three days and jumps come first on each", () => {
  assert.equal(SEED_PROGRAM.days.length, 3)
  const byKey = new Map(SEED_EXERCISES.map(exercise => [exercise.key, exercise]))
  for (const day of SEED_PROGRAM.days) {
    const first = byKey.get(day.entries[0].exerciseKey)!
    assert.equal(first.muscleGroup, "power", `${day.name} does not open with power work`)
  }
})
