import test from "node:test"
import assert from "node:assert/strict"
import { computeCapacityBand } from "../src/adaptive-day-capacity"
import { findCandidateSlot, longestFreeWindowMinutes, BUFFER_MINUTES } from "../src/adaptive-day-scheduling"
import { generateAdaptiveDayBrief, ADAPTIVE_DAY_RULES_VERSION } from "../src/adaptive-day-engine"
import { zonedTimeToUtc, localDayString, addDays, roundUpToQuarterHour } from "../src/adaptive-day-time"
import type { CapacityBandInput, AdaptiveDayEngineInput } from "../src/adaptive-day-types"

const NEUTRAL_CAPACITY: CapacityBandInput = {
  levelUpBand: null,
  fixedCommitmentMinutes: 0,
  longestFreeWindowMinutes: null,
  fixedBlockCount: 0,
  energy: null,
  stress: null,
}

// ── computeCapacityBand ──────────────────────────────────────────────────

test("capacity: no signals at all is full, not recover/adjust — missing is neutral", () => {
  const result = computeCapacityBand(NEUTRAL_CAPACITY)
  assert.equal(result.band, "full")
})

test("capacity: Level Up recover band forces recover regardless of anything else", () => {
  const result = computeCapacityBand({ ...NEUTRAL_CAPACITY, levelUpBand: "recover" })
  assert.equal(result.band, "recover")
  assert.ok(result.reasonCodes.includes("level_up_recover"))
})

test("capacity: low energy alone is adjust, not recover", () => {
  const result = computeCapacityBand({ ...NEUTRAL_CAPACITY, energy: 2 })
  assert.equal(result.band, "adjust")
  assert.ok(result.reasonCodes.includes("energy_low"))
})

test("capacity: high stress alone is adjust, not recover", () => {
  const result = computeCapacityBand({ ...NEUTRAL_CAPACITY, stress: 4 })
  assert.equal(result.band, "adjust")
  assert.ok(result.reasonCodes.includes("stress_high"))
})

test("capacity: low energy AND high stress together is recover", () => {
  const result = computeCapacityBand({ ...NEUTRAL_CAPACITY, energy: 1, stress: 5 })
  assert.equal(result.band, "recover")
  assert.deepEqual(result.reasonCodes.sort(), ["energy_low", "stress_high"])
})

test("capacity: energy 3 (not low) does not trigger anything", () => {
  const result = computeCapacityBand({ ...NEUTRAL_CAPACITY, energy: 3, stress: 3 })
  assert.equal(result.band, "full")
})

test("capacity: five hours of fixed commitments triggers adjust", () => {
  const result = computeCapacityBand({ ...NEUTRAL_CAPACITY, fixedCommitmentMinutes: 300 })
  assert.equal(result.band, "adjust")
  assert.ok(result.reasonCodes.includes("fixed_commitments_5h_plus"))
})

test("capacity: just under five hours does not trigger adjust on its own", () => {
  const result = computeCapacityBand({ ...NEUTRAL_CAPACITY, fixedCommitmentMinutes: 299 })
  assert.equal(result.band, "full")
})

test("capacity: four+ fixed blocks with no 90-minute window triggers adjust", () => {
  const result = computeCapacityBand({ ...NEUTRAL_CAPACITY, fixedBlockCount: 4, longestFreeWindowMinutes: 60 })
  assert.equal(result.band, "adjust")
  assert.ok(result.reasonCodes.includes("no_90min_window"))
})

test("capacity: four+ fixed blocks WITH a 90-minute window does not trigger", () => {
  const result = computeCapacityBand({ ...NEUTRAL_CAPACITY, fixedBlockCount: 5, longestFreeWindowMinutes: 90 })
  assert.equal(result.band, "full")
})

test("capacity: fewer than four fixed blocks never triggers the window rule even if tight", () => {
  const result = computeCapacityBand({ ...NEUTRAL_CAPACITY, fixedBlockCount: 2, longestFreeWindowMinutes: 10 })
  assert.equal(result.band, "full")
})

test("capacity: Level Up adjust band alone is adjust", () => {
  const result = computeCapacityBand({ ...NEUTRAL_CAPACITY, levelUpBand: "adjust" })
  assert.equal(result.band, "adjust")
})

// ── timezone / DST ────────────────────────────────────────────────────────

test("time: zonedTimeToUtc resolves a plain winter day correctly (PST, UTC-8)", () => {
  const instant = zonedTimeToUtc("2026-01-15", 8, 0, "America/Los_Angeles")
  assert.equal(instant.toISOString(), "2026-01-15T16:00:00.000Z")
})

test("time: zonedTimeToUtc resolves a summer day correctly (PDT, UTC-7)", () => {
  const instant = zonedTimeToUtc("2026-07-15", 8, 0, "America/Los_Angeles")
  assert.equal(instant.toISOString(), "2026-07-15T15:00:00.000Z")
})

test("time: zonedTimeToUtc is correct the day after a US spring-forward transition (2026-03-08)", () => {
  // 8am on the day after spring-forward is already PDT (UTC-7).
  const instant = zonedTimeToUtc("2026-03-09", 8, 0, "America/Los_Angeles")
  assert.equal(instant.toISOString(), "2026-03-09T15:00:00.000Z")
})

test("time: zonedTimeToUtc is correct the day after a US fall-back transition (2026-11-01)", () => {
  // 8am on the day after fall-back is already PST (UTC-8) again.
  const instant = zonedTimeToUtc("2026-11-02", 8, 0, "America/Los_Angeles")
  assert.equal(instant.toISOString(), "2026-11-02T16:00:00.000Z")
})

test("time: localDayString and zonedTimeToUtc round-trip", () => {
  const instant = zonedTimeToUtc("2026-06-01", 14, 30, "America/New_York")
  assert.equal(localDayString(instant, "America/New_York"), "2026-06-01")
})

test("time: addDays crosses a month boundary without touching any timezone", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01")
  assert.equal(addDays("2026-03-01", -1), "2026-02-28")
})

test("time: roundUpToQuarterHour rounds up, not down or to nearest", () => {
  const in_ = new Date("2026-06-01T14:01:00Z")
  assert.equal(roundUpToQuarterHour(in_).toISOString(), "2026-06-01T14:15:00.000Z")
  const exact = new Date("2026-06-01T14:15:00Z")
  assert.equal(roundUpToQuarterHour(exact).toISOString(), "2026-06-01T14:15:00.000Z")
})

// ── findCandidateSlot ────────────────────────────────────────────────────

const TZ = "America/Los_Angeles"

test("scheduling: an empty day returns the first candidate-window slot", () => {
  const slot = findCandidateSlot(30, {}, "2026-06-01", TZ, zonedTimeToUtc("2026-06-01", 7, 0, TZ))
  assert.ok(slot)
  assert.equal(slot!.day, "2026-06-01")
  assert.equal(slot!.start.toISOString(), zonedTimeToUtc("2026-06-01", 8, 0, TZ).toISOString())
})

test("scheduling: fits into a gap between two fixed blocks, honoring the 15-minute buffer", () => {
  const blocks = {
    // Block A starts exactly at the 8am candidate-window open, so there's no
    // room before it — the search has to find room after both blocks.
    "2026-06-01": [
      { start: zonedTimeToUtc("2026-06-01", 8, 0, TZ), end: zonedTimeToUtc("2026-06-01", 10, 0, TZ) },
      { start: zonedTimeToUtc("2026-06-01", 10, 40, TZ), end: zonedTimeToUtc("2026-06-01", 11, 0, TZ) },
    ],
  }
  // Gap between blocks is 10:00-10:40 = 40 real minutes, minus 15min buffer
  // on each side = 10 minutes of usable gap — too small for a 30-minute ask,
  // so the slot must land after block B's buffer ends at 11:15.
  const slot = findCandidateSlot(30, blocks, "2026-06-01", TZ, zonedTimeToUtc("2026-06-01", 7, 0, TZ))
  assert.ok(slot)
  assert.equal(slot!.start.toISOString(), zonedTimeToUtc("2026-06-01", 11, 15, TZ).toISOString())
})

test("scheduling: respects 'now' — never proposes a slot in the past on the search-start day", () => {
  const now = zonedTimeToUtc("2026-06-01", 13, 3, TZ)
  const slot = findCandidateSlot(30, {}, "2026-06-01", TZ, now)
  assert.ok(slot)
  assert.ok(slot!.start.getTime() >= now.getTime())
})

function fullDayBlock(day: string) {
  return [{ start: zonedTimeToUtc(day, 8, 0, TZ), end: zonedTimeToUtc(day, 20, 0, TZ) }]
}

test("scheduling: searches up to 3 days ahead when today is fully booked", () => {
  const blocks = {
    "2026-06-01": fullDayBlock("2026-06-01"),
    "2026-06-02": fullDayBlock("2026-06-02"),
    "2026-06-03": fullDayBlock("2026-06-03"),
  }
  const slot = findCandidateSlot(30, blocks, "2026-06-01", TZ, zonedTimeToUtc("2026-06-01", 7, 0, TZ))
  assert.ok(slot)
  assert.equal(slot!.day, "2026-06-04")
})

test("scheduling: returns null rather than a forced slot when all 4 candidate days are full", () => {
  const blocks = {
    "2026-06-01": fullDayBlock("2026-06-01"),
    "2026-06-02": fullDayBlock("2026-06-02"),
    "2026-06-03": fullDayBlock("2026-06-03"),
    "2026-06-04": fullDayBlock("2026-06-04"),
  }
  const slot = findCandidateSlot(30, blocks, "2026-06-01", TZ, zonedTimeToUtc("2026-06-01", 7, 0, TZ))
  assert.equal(slot, null)
})

test("scheduling: buffer constant is 15 minutes, matching docs/ADAPTIVE_DAY_PLAN.md", () => {
  assert.equal(BUFFER_MINUTES, 15)
})

// ── longestFreeWindowMinutes ─────────────────────────────────────────────

test("longestFreeWindowMinutes: an empty day's longest window is the whole window", () => {
  const start = zonedTimeToUtc("2026-06-01", 8, 0, TZ)
  const end = zonedTimeToUtc("2026-06-01", 20, 0, TZ)
  assert.equal(longestFreeWindowMinutes([], start, end), 12 * 60)
})

test("longestFreeWindowMinutes: finds the largest gap among several blocks, unbuffered", () => {
  const start = zonedTimeToUtc("2026-06-01", 8, 0, TZ)
  const end = zonedTimeToUtc("2026-06-01", 20, 0, TZ)
  const blocks = [
    { start: zonedTimeToUtc("2026-06-01", 9, 0, TZ), end: zonedTimeToUtc("2026-06-01", 9, 30, TZ) },
    { start: zonedTimeToUtc("2026-06-01", 12, 0, TZ), end: zonedTimeToUtc("2026-06-01", 12, 30, TZ) },
    { start: zonedTimeToUtc("2026-06-01", 12, 45, TZ), end: zonedTimeToUtc("2026-06-01", 13, 0, TZ) },
  ]
  // Largest gap is 13:00-20:00 = 420 minutes, bigger than the 9:30-12:00 gap.
  assert.equal(longestFreeWindowMinutes(blocks, start, end), 420)
})

test("longestFreeWindowMinutes: a fully booked day returns 0", () => {
  const start = zonedTimeToUtc("2026-06-01", 8, 0, TZ)
  const end = zonedTimeToUtc("2026-06-01", 20, 0, TZ)
  assert.equal(longestFreeWindowMinutes([{ start, end }], start, end), 0)
})

// ── generateAdaptiveDayBrief ─────────────────────────────────────────────

function baseEngineInput(overrides: Partial<AdaptiveDayEngineInput> = {}): AdaptiveDayEngineInput {
  return {
    day: "2026-06-01",
    timezone: TZ,
    now: zonedTimeToUtc("2026-06-01", 7, 0, TZ),
    capacity: NEUTRAL_CAPACITY,
    fixedBlocksByDay: {},
    unscheduledPlans: [],
    reschedulable: [],
    workout: null,
    ...overrides,
  }
}

test("engine: a full-capacity day with nothing to schedule and no workout returns zero interventions", () => {
  const result = generateAdaptiveDayBrief(baseEngineInput())
  assert.equal(result.capacityBand, "full")
  assert.deepEqual(result.interventions, [])
  assert.equal(result.rulesVersion, ADAPTIVE_DAY_RULES_VERSION)
})

test("engine: an unscheduled plan on a full day still gets a schedule proposal", () => {
  const result = generateAdaptiveDayBrief(baseEngineInput({
    unscheduledPlans: [{ id: "p1", text: "Write the report", estimatedMinutes: 30 }],
  }))
  assert.equal(result.interventions.length, 1)
  assert.equal(result.interventions[0].category, "plan_schedule")
  assert.equal(result.interventions[0].proposedCommand?.command, "plan.schedule")
})

test("engine: a constrained day prefers rescheduling over scheduling when both are available", () => {
  const result = generateAdaptiveDayBrief(baseEngineInput({
    capacity: { ...NEUTRAL_CAPACITY, fixedCommitmentMinutes: 320 },
    unscheduledPlans: [{ id: "p1", text: "New task", estimatedMinutes: 30 }],
    reschedulable: [{
      id: "p2", text: "Movable task", estimatedMinutes: 30,
      scheduledStart: zonedTimeToUtc("2026-06-01", 9, 0, TZ),
      scheduledEnd: zonedTimeToUtc("2026-06-01", 9, 30, TZ),
    }],
  }))
  assert.equal(result.capacityBand, "adjust")
  const scheduleLike = result.interventions.filter(i => i.category === "plan_schedule" || i.category === "plan_reschedule")
  assert.equal(scheduleLike.length, 1)
  assert.equal(scheduleLike[0].category, "plan_reschedule")
})

test("engine: never proposes increasing workout load on a full-capacity day", () => {
  const result = generateAdaptiveDayBrief(baseEngineInput({
    workout: { scheduledToday: true, levelUpBand: "full" },
  }))
  assert.equal(result.interventions.filter(i => i.category === "workout_adjustment").length, 0)
})

test("engine: recover band with a scheduled workout proposes lightening it, with a real command", () => {
  const result = generateAdaptiveDayBrief(baseEngineInput({
    capacity: { ...NEUTRAL_CAPACITY, levelUpBand: "recover" },
    workout: { scheduledToday: true, levelUpBand: "recover" },
  }))
  const workoutIv = result.interventions.find(i => i.category === "workout_adjustment")
  assert.ok(workoutIv)
  assert.equal(workoutIv!.proposedCommand?.command, "level_up.record_recommendation")
})

test("engine: adjust band with a scheduled workout only acknowledges, no proposedCommand", () => {
  const result = generateAdaptiveDayBrief(baseEngineInput({
    capacity: { ...NEUTRAL_CAPACITY, levelUpBand: "adjust" },
    workout: { scheduledToday: true, levelUpBand: "adjust" },
  }))
  const workoutIv = result.interventions.find(i => i.category === "workout_adjustment")
  assert.ok(workoutIv)
  assert.equal(workoutIv!.proposedCommand, null)
})

test("engine: capacity guidance only appears when nothing more concrete was proposed", () => {
  const constrained = generateAdaptiveDayBrief(baseEngineInput({
    capacity: { ...NEUTRAL_CAPACITY, fixedCommitmentMinutes: 320 },
  }))
  assert.equal(constrained.interventions.length, 1)
  assert.equal(constrained.interventions[0].category, "capacity_guidance")

  const constrainedWithSchedule = generateAdaptiveDayBrief(baseEngineInput({
    capacity: { ...NEUTRAL_CAPACITY, fixedCommitmentMinutes: 320 },
    unscheduledPlans: [{ id: "p1", text: "New task", estimatedMinutes: 30 }],
  }))
  assert.ok(!constrainedWithSchedule.interventions.some(i => i.category === "capacity_guidance"))
})

test("engine: caps at three interventions and ranks sequentially from 0", () => {
  const result = generateAdaptiveDayBrief(baseEngineInput({
    capacity: { ...NEUTRAL_CAPACITY, levelUpBand: "recover" },
    unscheduledPlans: [{ id: "p1", text: "New task", estimatedMinutes: 30 }],
    workout: { scheduledToday: true, levelUpBand: "recover" },
  }))
  assert.ok(result.interventions.length <= 3)
  result.interventions.forEach((iv, i) => assert.equal(iv.rank, i))
})

test("engine: missingSignals lists exactly the absent inputs, never treats them as negative", () => {
  const result = generateAdaptiveDayBrief(baseEngineInput())
  assert.deepEqual(result.missingSignals.sort(), ["energyCheckIn", "levelUpReadiness", "stressCheckIn"])
  assert.equal(result.capacityBand, "full")
})

test("engine: no missing signals when every input is present", () => {
  const result = generateAdaptiveDayBrief(baseEngineInput({
    capacity: { ...NEUTRAL_CAPACITY, levelUpBand: "full", energy: 3, stress: 3 },
  }))
  assert.deepEqual(result.missingSignals, [])
})
