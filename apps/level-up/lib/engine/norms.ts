import type { Direction } from "./curve"
import type { NormParams, Sex } from "./types"

// ─────────────────────────────────────────────
// NORMATIVE HELPERS
//
// Where a governing body maintains a real table (VO2max via ACSM/FRIEND,
// running via WMA) we lean on it. Everywhere else adult-over-30 age adjustment
// is uneven (spec Part 12, open problem), so we apply a modeled decline curve
// and flag it `modeled: true` — the UI is expected to surface that flag rather
// than pretend a decade of missing data exists.
// ─────────────────────────────────────────────

/**
 * Model a physical peak that holds until `startAge`, then declines at
 * `ratePerYear` (as a fraction of the peak) thereafter. For "lower is better"
 * tests the mean grows instead of shrinks. Returns the age-adjusted mean.
 */
export function ageDecline(
  peak: number,
  age: number,
  ratePerYear: number,
  direction: Direction,
  startAge = 30,
): number {
  if (age <= startAge) return peak
  const years = age - startAge
  const factor = 1 - ratePerYear * years
  if (direction === "higher") return peak * Math.max(0.25, factor)
  // lower-is-better: performance worsens → value increases
  return peak * (1 + ratePerYear * years)
}

/** Build a NormParams with the age-adjusted mean and a (constant) SD. */
export function norm(mean: number, sd: number, modeled: boolean): NormParams {
  return { mean, sd, modeled }
}

/** Female-vs-male absolute-performance multipliers, applied to the mean. These
 * are coarse and flagged modeled; the primary user is male. */
export const SEX_FACTOR: Record<string, { m: number; f: number }> = {
  strength: { m: 1, f: 0.62 },
  jump: { m: 1, f: 0.68 },
  speed: { m: 1, f: 0.88 },
  vo2: { m: 1, f: 0.82 },
  grip: { m: 1, f: 0.6 },
  reaction: { m: 1, f: 1.02 },
  generic: { m: 1, f: 0.85 },
}

export function sexAdjust(value: number, sex: Sex, kind: keyof typeof SEX_FACTOR): number {
  const f = SEX_FACTOR[kind] ?? SEX_FACTOR.generic
  return value * (sex === "male" ? f.m : f.f)
}
