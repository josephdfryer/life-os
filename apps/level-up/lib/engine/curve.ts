// ─────────────────────────────────────────────
// THE CONVERSION CURVE (spec Part 2)
//
// The user sees a letter and a number. This file is where the number comes
// from — and it is deliberately the least emotional file in the codebase.
//
// Two regimes:
//   • Population-referenced (up to rating 81 / z≈+2.5): route the raw result
//     through a z-score, then RATING = 62 + 30·tanh(0.30·z), floor 30.
//   • Ceiling-referenced (above 81): percentiles stop resolving the elite tail,
//     so interpolate linearly between named per-attribute anchors at 81/90/99.
//
// The two curves are blended across the 78–84 band so a small gain near the
// splice never jumps three ratings.
// ─────────────────────────────────────────────

export const AVERAGE_RATING = 62 // the median adult, C rank, day one
export const RATING_FLOOR = 30
export const RATING_MAX = 99
export const CEILING_ANCHOR_RATING = 81 // z = +2.5, 99.4th percentile

export type Direction = "higher" | "lower"

/** Raw value → z-score. `direction: "lower"` (times, reaction) flips the sign
 * so that a better performance is always a positive z. */
export function zScore(value: number, mean: number, sd: number, direction: Direction): number {
  if (sd <= 0) return 0
  const z = (value - mean) / sd
  return direction === "lower" ? -z : z
}

/** Population-referenced rating. The whole bottom-and-middle of humanity lives
 * here. Slope ≈ 8.7 pts/SD through the middle, tapering with tanh. */
export function populationRating(z: number): number {
  const r = AVERAGE_RATING + 30 * Math.tanh(0.3 * z)
  return Math.max(RATING_FLOOR, r)
}

export type CeilingAnchors = {
  /** raw value at the 99.4th percentile (rating 81) */
  v81: number
  /** raw value at the elite competitive standard (rating 90) */
  v90: number
  /** raw value at the human frontier, best ever recorded (rating 99) */
  v99: number
}

/**
 * Ceiling-referenced rating. Linear interpolation between anchors, in raw
 * units. Works for both directions because we interpolate on the anchor pair
 * that brackets the value; "lower is better" simply means v81 > v90 > v99.
 * Below the 81 anchor we extrapolate the 81→90 segment (used only inside the
 * blend band).
 */
export function ceilingRating(value: number, a: CeilingAnchors): number {
  const seg = (rLo: number, rHi: number, vLo: number, vHi: number) =>
    rLo + (rHi - rLo) * ((value - vLo) / (vHi - vLo))

  const higher = a.v99 >= a.v81
  const between = (lo: number, hi: number) =>
    higher ? value >= lo && value <= hi : value <= lo && value >= hi

  let r: number
  if (between(a.v90, a.v99)) r = seg(90, 99, a.v90, a.v99)
  else if (higher ? value > a.v99 : value < a.v99) r = 99 // beyond frontier
  else r = seg(81, 90, a.v81, a.v90) // 81→90 segment, extrapolated below v81
  return Math.min(RATING_MAX, Math.max(RATING_FLOOR, r))
}

/**
 * Splice the population and ceiling curves. Below rating 78 the population
 * number stands alone. Above 84 the ceiling number takes over. In the 78–84
 * band we cross-fade so there is no visible discontinuity at the splice.
 * When no anchors exist for an attribute, the rating is honestly capped at 81
 * (see caps: you cannot claim an elite tail from a general-population norm).
 */
export function spliceRating(popRating: number, anchors: CeilingAnchors | null, value: number): number {
  if (!anchors) return Math.min(popRating, CEILING_ANCHOR_RATING)
  const ceil = ceilingRating(value, anchors)
  if (popRating <= 78) return popRating
  if (popRating >= 84) return ceil
  const t = (popRating - 78) / (84 - 78)
  return popRating * (1 - t) + ceil * t
}

/**
 * Running events skip interpolation entirely: feed the time into a WMA
 * age-grading calculator and map the resulting percentage straight to a rating.
 * The spec fixes 70%→81, 80%→87, 90%→94, 100%→99. Below 70% is modeled as a
 * line down through (50%, 62) — the median adult — and flagged as modeled.
 */
export function wmaRating(ageGradePercent: number): number {
  const anchors: Array<[number, number]> = [
    [50, 62],
    [70, 81],
    [80, 87],
    [90, 94],
    [100, 99],
  ]
  if (ageGradePercent <= anchors[0][0]) {
    // extrapolate the 50→70 slope downward, floor 30
    const [x0, y0] = anchors[0]
    const [x1, y1] = anchors[1]
    const slope = (y1 - y0) / (x1 - x0)
    return Math.max(RATING_FLOOR, y0 + slope * (ageGradePercent - x0))
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i]
    const [x1, y1] = anchors[i + 1]
    if (ageGradePercent <= x1) {
      return y0 + (y1 - y0) * ((ageGradePercent - x0) / (x1 - x0))
    }
  }
  return RATING_MAX
}

export const RANKS = [
  { min: 98, letter: "SS", band: "Human frontier" },
  { min: 90, letter: "S", band: "Elite → world class" },
  { min: 80, letter: "A", band: "Highly athletic" },
  { min: 71, letter: "B", band: "Fit" },
  { min: 62, letter: "C", band: "Normal adult" },
  { min: 50, letter: "D", band: "Below average" },
  { min: 40, letter: "E", band: "Poor" },
  { min: 0, letter: "E−", band: "Severely limited" },
] as const

export type Rank = { letter: string; band: string }

export function rankFor(rating: number): Rank {
  for (const r of RANKS) {
    if (rating >= r.min) return { letter: r.letter, band: r.band }
  }
  return { letter: "E−", band: "Severely limited" }
}

export function roundRating(rating: number): number {
  return Math.round(Math.max(RATING_FLOOR, Math.min(RATING_MAX, rating)))
}
