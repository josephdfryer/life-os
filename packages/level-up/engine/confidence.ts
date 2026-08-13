import type { ConfidenceLevel } from "./types"

// ─────────────────────────────────────────────
// CONFIDENCE BANDS & THE NOISE FLOOR (spec Part 4)
//
// The honest response to thin data is a lower number that visibly rises as you
// prove it — not a blocked screen. Every rating carries an interval, and the
// card shows the LOWER BOUND until confidence narrows to a midpoint. Confirming
// a rating you already earned feels like progress, because it is.
// ─────────────────────────────────────────────

export function confidenceFor(testCount: number, spanWeeks: number, hasHistory: boolean): ConfidenceLevel {
  if (hasHistory && spanWeeks >= 26) {
    return { band: 1.5, display: "mid", label: "Established — 6+ months of history" }
  }
  if (testCount >= 3 && spanWeeks >= 8) {
    return { band: 3, display: "mid", label: "Three tests over 8+ weeks" }
  }
  if (testCount >= 2 && spanWeeks >= 4) {
    return { band: 4, display: "lower", label: "Two tests, 4+ weeks apart" }
  }
  if (testCount >= 1) {
    return { band: 6, display: "lower", label: "One test — re-test to confirm" }
  }
  return { band: 8, display: "lower", label: "Self-reported — unconfirmed" }
}

/**
 * What the card actually shows: the lower bound of the interval until
 * confidence is high enough to trust the midpoint.
 */
export function displayValue(midpoint: number, c: ConfidenceLevel): number {
  return c.display === "lower" ? midpoint - c.band : midpoint
}

/**
 * Noise floor: test-retest variation (≈3–5% for a CMJ). The first time a test
 * is run twice, the gap between the two numbers IS the noise floor. The engine
 * refuses to render a delta smaller than it — nothing corrodes trust like
 * celebrating noise. Default to 4% of the value when we don't yet have a
 * measured floor.
 */
export function noiseFloor(values: number[]): number {
  if (values.length < 2) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const spread = sorted[sorted.length - 1] - sorted[0]
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return Math.max(spread, mean * 0.04)
}

export function isRealDelta(delta: number, floor: number): boolean {
  return Math.abs(delta) > floor
}
