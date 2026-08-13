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
