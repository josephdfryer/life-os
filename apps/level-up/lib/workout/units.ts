// ─────────────────────────────────────────────
// UNITS AND PLATE MATH
//
// Storage is always kg — the engine's norms are metric and every rating flows
// through them. Pounds exist only where a human touches the number: the wheel
// and the readout. Converting at that boundary (and nowhere else) is what keeps
// the two from drifting.
//
// The weight wheel does not count in integers. It counts in what you can
// actually load on a bar: 2.5 lb steps from the plate pairs in every gym, or
// 1.25 lb steps once micro-plates are in the bag.
// ─────────────────────────────────────────────

export type Unit = "lb" | "kg"

const LB_PER_KG = 2.2046226218

export function kgToLb(kg: number) {
  return kg * LB_PER_KG
}

export function lbToKg(lb: number) {
  return lb / LB_PER_KG
}

/** Convert a stored kg load into the display unit, unrounded. */
export function fromKg(kg: number, unit: Unit) {
  return unit === "kg" ? kg : kgToLb(kg)
}

/** Convert a wheel value in the display unit back to storage kg. */
export function toKg(value: number, unit: Unit) {
  return unit === "kg" ? value : lbToKg(value)
}

/**
 * The smallest change you can actually make to the bar. Pounds move in 2.5 lb
 * pairs (a 1.25 lb plate per side) or 1.25 lb with micro-plates; kilos move in
 * 2.5 kg or 1 kg. These are equipment facts, not preferences.
 */
export function loadStep(unit: Unit, microPlates: boolean) {
  if (unit === "kg") return microPlates ? 1 : 2.5
  return microPlates ? 1.25 : 2.5
}

/** Snap an arbitrary load to the nearest loadable value on the wheel. */
export function snapToStep(value: number, step: number) {
  return Math.round(value / step) * step
}

/**
 * Trim float noise from plate math. 2.5 lb steps accumulate binary error, and a
 * wheel reading "227.50000000000003" would be a bug the user can see.
 */
export function roundLoad(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * The values on the weight wheel, ascending. BWT is not in here — it is a
 * separate sentinel the picker appends, because bodyweight is a different kind
 * of thing from a number and pretending otherwise makes the column lie.
 */
export function loadWheelValues(unit: Unit, microPlates: boolean): number[] {
  const step = loadStep(unit, microPlates)
  const max = unit === "kg" ? 300 : 675
  const values: number[] = []
  for (let value = 0; value <= max; value += step) values.push(roundLoad(value))
  return values
}

/**
 * An empty olympic bar. The seed for a loaded movement with no history: zero is
 * a number you can't actually lift, and leaving the wheel there makes the first
 * set of any new movement one mistap away from meaningless evidence.
 */
export function emptyBar(unit: Unit) {
  return unit === "kg" ? 20 : 45
}

export function repWheelValues(max = 30): number[] {
  return Array.from({ length: max }, (_, index) => index + 1)
}

/**
 * Duration wheel in seconds. Fine-grained where timed sets actually live (up to
 * two minutes), coarser after, so the column stays scrollable.
 */
export function durationWheelValues(): number[] {
  const values: number[] = []
  for (let seconds = 5; seconds <= 120; seconds += 5) values.push(seconds)
  for (let seconds = 135; seconds <= 600; seconds += 15) values.push(seconds)
  return values
}

export function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`
}

export function formatClock(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

/** Display a load the way it reads on a wheel: no trailing .0, one decimal max. */
export function formatLoad(value: number) {
  const rounded = roundLoad(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "")
}
