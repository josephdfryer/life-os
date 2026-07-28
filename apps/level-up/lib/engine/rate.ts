import { populationRating, spliceRating, wmaRating, zScore } from "./curve"
import type { NormContext, ReferencePopulation, Sex, TestDefinition } from "./types"

// ─────────────────────────────────────────────
// PER-TEST RATING
//
// Route one raw measurement through z → curve → splice for a chosen reference
// population. The reference population is not cosmetic: it changes the norm and
// therefore the number. The card defaults to Human; the deep screen reveals
// Trained and Age-Adjusted.
// ─────────────────────────────────────────────

/**
 * Which age to compare against for each reference population:
 *   • human — the absolute adult standard (peak reference age, capped at 30),
 *     so a 45-year-old is honestly measured against humanity at large.
 *   • age   — your own age cohort; flattering after 35, and the truest measure
 *     of whether you're beating the decline curve.
 *   • trained — your own age, but against people who train the attribute.
 */
function referenceAge(actualAge: number, population: ReferencePopulation): number {
  if (population === "human") return Math.min(actualAge, 30)
  return actualAge
}

export type RateArgs = {
  def: TestDefinition
  value: number
  bodyweightKg?: number | null
  age: number
  sex: Sex
  population: ReferencePopulation
}

/** The normalized value the norms and anchors are expressed in. */
export function normalizedValue(def: TestDefinition, value: number, bodyweightKg?: number | null): number {
  if (def.relative) {
    if (!bodyweightKg || bodyweightKg <= 0) return value // can't normalize; treat as-is
    return value / bodyweightKg
  }
  return value
}

export function rateTest(args: RateArgs): number {
  const { def, value, bodyweightKg, age, sex, population } = args

  // Running events map straight through WMA age-grading; no z, no anchors.
  if (def.wma) return wmaRating(value)

  const v = normalizedValue(def, value, bodyweightKg)
  const ctx: NormContext = {
    age: referenceAge(age, population),
    sex,
    population: population === "age" ? "human" : population, // "age" uses the human norm set at your real age
  }
  const n = def.norm(ctx)
  if (!n) return populationRating(0) // no norm and not WMA → treat as median
  const z = zScore(v, n.mean, n.sd, def.direction)
  const pop = populationRating(z)
  return spliceRating(pop, def.anchors ?? null, v)
}

/** Whether this test's norm is modeled (age adjustment beyond real tables). */
export function isModeled(def: TestDefinition, age: number, sex: Sex): boolean {
  if (def.wma) return age > 0 // WMA already age-graded; flagged modeled below 70% only in UI
  const n = def.norm({ age, sex, population: def.populationDefault === "trained" ? "trained" : "human" })
  return n?.modeled ?? true
}
