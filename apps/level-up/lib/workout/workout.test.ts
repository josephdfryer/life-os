import assert from "node:assert/strict"
import test from "node:test"
import {
  emptyBar,
  formatClock,
  formatDuration,
  formatLoad,
  fromKg,
  loadStep,
  loadWheelValues,
  roundLoad,
  snapToStep,
  toKg,
} from "./units"
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
} from "./metrics"
import { SEED_EXERCISES, SEED_PROGRAM, resolveSubstitution } from "./seed-program"

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

// ── Units and plate math ──

test("pounds round-trip through kilograms without drift", () => {
  const lb = 225
  assert.ok(Math.abs(fromKg(toKg(lb, "lb"), "lb") - lb) < 1e-9)
  assert.equal(toKg(100, "kg"), 100)
})

test("the weight wheel steps by loadable plate math, not integers", () => {
  assert.equal(loadStep("lb", false), 2.5)
  assert.equal(loadStep("lb", true), 1.25)
  assert.equal(loadStep("kg", false), 2.5)
  assert.equal(loadStep("kg", true), 1)
})

test("the weight wheel carries no float noise", () => {
  const values = loadWheelValues("lb", false)
  assert.equal(values[0], 0)
  assert.equal(values[1], 2.5)
  assert.equal(values[90], 225)
  assert.ok(values.every(value => value === roundLoad(value)))
  // 2.5 accumulated 270 times is where binary error would surface.
  assert.equal(values[values.length - 1], 675)
})

test("micro-plates halve the pound wheel's step", () => {
  const coarse = loadWheelValues("lb", false)
  const fine = loadWheelValues("lb", true)
  assert.equal(fine.length, coarse.length * 2 - 1)
  assert.equal(fine[1], 1.25)
})

test("an arbitrary load snaps to something you can actually load", () => {
  assert.equal(snapToStep(224, 2.5), 225)
  assert.equal(snapToStep(223.7, 2.5), 222.5)
  assert.equal(snapToStep(101.2, 2.5), 100)
})

test("a loaded movement with no history seeds to the bar, not to zero", () => {
  assert.equal(emptyBar("lb"), 45)
  assert.equal(emptyBar("kg"), 20)
  // The seed has to land on a value the wheel actually contains.
  assert.ok(loadWheelValues("lb", false).includes(snapToStep(emptyBar("lb"), loadStep("lb", false))))
  assert.ok(loadWheelValues("kg", false).includes(snapToStep(emptyBar("kg"), loadStep("kg", false))))
})

test("loads and clocks format the way they read on a wheel", () => {
  assert.equal(formatLoad(225), "225")
  assert.equal(formatLoad(1.25), "1.25")
  assert.equal(formatClock(0), "00:00")
  assert.equal(formatClock(95), "01:35")
  assert.equal(formatDuration(45), "0m 45s")
  assert.equal(formatDuration(135), "2m 15s")
})

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
