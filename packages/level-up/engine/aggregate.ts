import { ATTRIBUTE_LABELS, POINTS_PER_SD, SUB_LABELS } from "./attributes"
import { getTest, TEST_CATALOG } from "./catalog"
import { rankFor, roundRating } from "./curve"
import { confidenceFor, displayValue } from "./confidence"
import { normalizedValue, rateTest } from "./rate"
import type {
  AttributeKey,
  AttributeRating,
  EvidenceItem,
  Profile,
  SubRating,
  TestResultInput,
} from "./types"

// ─────────────────────────────────────────────
// ATTRIBUTE AGGREGATION
// Turn a pile of raw measurements into the ten headline ratings, complete with
// residual sub-ratings, hard gates, confidence bands, and the provisional-lift
// mechanic (typed training data moves you within your proven range, never past
// a combine-verified ceiling).
// ─────────────────────────────────────────────

const DEFAULT_AGE = 30

export function ageFromBirth(birthDate: Date | null, now: Date): number {
  if (!birthDate) return DEFAULT_AGE
  const ms = now.getTime() - birthDate.getTime()
  return Math.max(12, Math.floor(ms / (365.25 * 24 * 3600 * 1000)))
}

type Grouped = Map<string, TestResultInput[]> // key -> results newest first

function group(results: TestResultInput[]): Grouped {
  const m: Grouped = new Map()
  for (const r of results) {
    const arr = m.get(r.testKey)
    if (arr) arr.push(r)
    else m.set(r.testKey, [r])
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => (b.measuredAt?.getTime() ?? 0) - (a.measuredAt?.getTime() ?? 0))
  }
  return m
}

function latest(g: Grouped, key: string): TestResultInput | undefined {
  return g.get(key)?.[0]
}

type RateFn = (key: string, population?: "human" | "trained" | "age") => number | null

function makeRateFn(g: Grouped, profile: Profile, age: number): RateFn {
  return (key, population = "human") => {
    const def = getTest(key)
    const r = latest(g, key)
    if (!def || !r) return null
    return rateTest({
      def,
      value: r.value,
      bodyweightKg: r.bodyweightKg ?? profile.bodyweightKg,
      age,
      sex: profile.sex,
      population,
    })
  }
}

function rawVal(g: Grouped, key: string): number | null {
  return latest(g, key)?.value ?? null
}

const avg = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

const present = (...xs: (number | null)[]): number[] => xs.filter((x): x is number => x != null)

// ── Headline combination per attribute (avoids double-counting correlated tests) ──
function headlineFor(attr: AttributeKey, R: RateFn): number | null {
  switch (attr) {
    case "strength": {
      const grip = R("grip")
      const rel = avg(present(R("trap_bar_dl", "trained"), R("weighted_pullup", "trained")))
      const abs = R("bench_press", "trained")
      // Grip drives the Human rating; barbell drives the ceiling.
      const parts: Array<[number, number]> = []
      if (grip != null) parts.push([grip, 0.45])
      if (rel != null) parts.push([rel, 0.4])
      if (abs != null) parts.push([abs, 0.15])
      return weighted(parts)
    }
    case "power": {
      const cmj = R("vertical_cmj")
      const broad = R("broad_jump")
      const rsi = R("drop_jump_rsi")
      return weighted(
        present2([cmj, 0.5], [broad, 0.25], [rsi, 0.25]),
      )
    }
    case "speed": {
      // Flying-10 is primary; 10m stands in if it's all we have.
      return R("flying10_velocity") ?? R("sprint_10m")
    }
    case "agility":
      return R("shuttle_5_10_5") ?? R("reactive_shuttle") ?? R("test_505")
    case "engine": {
      // Best credible aerobic evidence wins; a 5k (WMA) is exact at the top.
      return maxNonNull(R("run_5k_wma"), R("vo2max"))
    }
    case "workCapacity":
      return avg(present(R("pushups_max"), R("dead_hang"), R("plank")))
    case "mobility": {
      const ankle = avg(present(R("knee_to_wall_l"), R("knee_to_wall_r")))
      const hip = avg(present(R("sit_and_reach"), R("deep_squat_hold")))
      const shoulder = R("shoulder_reach")
      return avg(present(ankle, hip, shoulder))
    }
    case "control":
      return avg(
        present(R("single_leg_stance_ec"), R("y_balance"), R("drop_landing_score"), R("nine_hole_peg")),
      )
    case "reaction":
      return weighted(present2([R("simple_rt"), 0.7], [R("rt_variance"), 0.3]))
    case "resilience":
      return null // computed separately from behavior/history
    default:
      return null
  }
}

function weighted(parts: Array<[number, number]>): number | null {
  if (!parts.length) return null
  const totalW = parts.reduce((a, [, w]) => a + w, 0)
  return parts.reduce((a, [v, w]) => a + v * w, 0) / totalW
}
function present2(...parts: Array<[number | null, number]>): Array<[number, number]> {
  return parts.filter((p): p is [number, number] => p[0] != null)
}
function maxNonNull(...xs: (number | null)[]): number | null {
  const p = present(...xs)
  return p.length ? Math.max(...p) : null
}

// ── Residual & independent sub-ratings ──────────────────────────────
function residualSd(actual: number, predicted: number): number {
  return (actual - predicted) / POINTS_PER_SD
}

function subRatingsFor(attr: AttributeKey, R: RateFn, g: Grouped): SubRating[] {
  const subs: SubRating[] = []
  const push = (key: string, rating: number | null, extra?: Partial<SubRating>) =>
    subs.push({ key, label: SUB(key), rating: rating == null ? null : roundRating(rating), ...extra })

  switch (attr) {
    case "strength":
      push("relativeStrength", avg(present(R("trap_bar_dl", "trained"), R("weighted_pullup", "trained"))))
      push("absoluteStrength", R("bench_press", "trained"))
      push("grip", R("grip"))
      break
    case "power": {
      push("verticalPower", R("vertical_cmj"))
      push("reactiveStrength", R("drop_jump_rsi"))
      // Elastic Power = eccentric utilization ratio (CMJ − SJ, as %).
      const cmj = rawVal(g, "vertical_cmj")
      const sj = rawVal(g, "squat_jump")
      if (cmj != null && sj != null && sj > 0) {
        const eur = ((cmj - sj) / sj) * 100
        // 0% springs → ~50, 20%+ → elite spring. Map linearly to a rating.
        const rating = 55 + Math.min(30, Math.max(-10, eur)) * 1.1
        push("elasticPower", rating, { detail: `${eur.toFixed(0)}% eccentric utilization` })
      } else {
        push("elasticPower", null, { detail: "needs both CMJ and squat jump" })
      }
      break
    }
    case "speed": {
      push("maxVelocity", R("flying10_velocity"))
      // Acceleration = 10m residual vs what flying-10 velocity predicts.
      const fly = R("flying10_velocity")
      const ten = R("sprint_10m")
      if (fly != null && ten != null) {
        const sd = residualSd(ten, fly)
        push("acceleration", 62 + sd * POINTS_PER_SD, {
          residualSd: sd,
          detail: `${sd >= 0 ? "+" : ""}${sd.toFixed(1)} SD vs top-speed prediction`,
        })
      } else push("acceleration", null, { detail: "needs flying-10 and 10m" })
      // Speed Maintenance = decay residual.
      const decay = R("sprint_40m_decay")
      if (decay != null && fly != null) {
        const sd = residualSd(decay, fly)
        push("speedMaintenance", 62 + sd * POINTS_PER_SD, { residualSd: sd })
      } else push("speedMaintenance", null)
      break
    }
    case "agility": {
      push("changeOfDirection", R("shuttle_5_10_5"))
      push("deceleration", R("test_505"))
      // Reactive Agility = reactive residual vs planned prediction.
      const planned = R("shuttle_5_10_5")
      const reactive = R("reactive_shuttle")
      if (planned != null && reactive != null) {
        const sd = residualSd(reactive, planned)
        push("reactiveAgility", 62 + sd * POINTS_PER_SD, {
          residualSd: sd,
          detail: `${sd >= 0 ? "+" : ""}${sd.toFixed(1)} SD — perception & decision-making`,
        })
      } else push("reactiveAgility", null, { detail: "needs a validated reactive test" })
      push("symmetry", R("shuttle_lr_delta"))
      break
    }
    case "engine":
      push("aerobicCapacity", maxNonNull(R("vo2max"), R("run_5k_wma")))
      push("threshold", R("run_5k_wma"))
      push("hrRecovery", R("hr_recovery_60s"))
      break
    case "workCapacity":
      push("repeatEffort", R("repeat_sprint_decay"))
      break
    case "mobility": {
      push("ankle", avg(present(R("knee_to_wall_l"), R("knee_to_wall_r"))))
      push("hip", avg(present(R("sit_and_reach"), R("deep_squat_hold"))))
      push("shoulder", R("shoulder_reach"))
      // Symmetry: L/R ankle delta is the finding.
      const l = rawVal(g, "knee_to_wall_l")
      const r = rawVal(g, "knee_to_wall_r")
      if (l != null && r != null) {
        const delta = Math.abs(l - r)
        const rating = 75 - delta * 5 // 0cm → 75, 4cm → 55
        push("symmetry", rating, { detail: `${delta.toFixed(1)} cm L/R ankle difference` })
      } else push("symmetry", null)
      break
    }
    case "control":
      push("staticBalance", R("single_leg_stance_ec"))
      push("dynamicBalance", R("y_balance"))
      push("landingControl", R("drop_landing_score"))
      push("fineMotor", R("nine_hole_peg"))
      break
    case "reaction":
      push("latency", R("simple_rt"))
      push("consistency", R("rt_variance"))
      break
  }
  return subs
}

function SUB(key: string): string {
  return SUB_LABELS[key] ?? key
}

// ── Hard gates (spec Part 4) ────────────────────────────────────────
function capFor(
  attr: AttributeKey,
  g: Grouped,
  hasSixMonthHistory: boolean,
): { cap: number; reason: string } | null {
  const has = (key: string) => g.has(key)
  const flag = (key: string, f: string) => {
    const fl = latest(g, key)?.protocolFlags
    return !!fl && fl[f] === true
  }
  const sourceOf = (key: string) => latest(g, key)?.source
  switch (attr) {
    case "speed":
      if (!flag("flying10_velocity", "electronic") && !flag("flying10_velocity", "120fps"))
        return { cap: 81, reason: "≥120 fps timing or electronic gates required — no stopwatch" }
      return null
    case "agility":
      if (!has("reactive_shuttle"))
        return { cap: 79, reason: "Complete the Reactive Cut Test to unlock 80+" }
      return null
    case "strength":
      if (!flag("trap_bar_dl", "video-verified"))
        return { cap: 81, reason: "Full-ROM standardized lifts, video verified" }
      return null
    case "engine": {
      const lab = (has("vo2max") && sourceOf("vo2max") !== "wearable") || has("run_5k_wma")
      if (!lab) return { cap: 81, reason: "Cooper, 5k or lab test — not a wearable estimate" }
      return null
    }
    case "power":
      if (!flag("vertical_cmj", "force-plate") && !flag("vertical_cmj", "validated-app"))
        return { cap: 84, reason: "Force-plate or validated flight-time app, not chalk marks" }
      return null
    case "resilience":
      if (!hasSixMonthHistory)
        return { cap: 75, reason: "≥6 months of continuous training and injury data" }
      return null
    default:
      return null
  }
}

// ── Resilience: behavioral, earned slowly ───────────────────────────
export type ResilienceInputs = {
  trainingDaysTrailing12wk: number
  plannedPerWeek: number
  hasSixMonthHistory: boolean
  symmetryRating: number | null // from unilateral deltas; gates resilience
  injurySessionsLost: number
}

function resilienceRating(r: ResilienceInputs): { rating: number; subs: SubRating[] } {
  const target = Math.max(1, r.plannedPerWeek) * 12
  const availabilityFrac = Math.min(1, r.trainingDaysTrailing12wk / target)
  const availability = 45 + 35 * availabilityFrac // 0 → 45, 1.0 → 80 (capped later)
  const injuryPenalty = Math.min(15, r.injurySessionsLost * 1.5)
  const symmetryPull = r.symmetryRating != null ? (r.symmetryRating - 70) * 0.3 : 0
  const rating = Math.max(30, availability - injuryPenalty + symmetryPull)
  const subs: SubRating[] = [
    { key: "availability", label: SUB("availability"), rating: roundRating(availability), detail: `${(availabilityFrac * 100).toFixed(0)}% of planned` },
    { key: "recovery", label: SUB("recovery"), rating: null, detail: "needs objective HRV (Garmin)" },
    { key: "symmetry", label: SUB("symmetry"), rating: r.symmetryRating == null ? null : roundRating(r.symmetryRating) },
  ]
  return { rating, subs }
}

export type ComputeInput = {
  results: TestResultInput[]
  profile: Profile
  now: Date
  /** combine-verified ceilings per attribute from the last completed combine snapshot */
  verifiedCeilings?: Partial<Record<AttributeKey, number>>
  resilience: ResilienceInputs
}

export function computeAttributes(input: ComputeInput): AttributeRating[] {
  const { results, profile, now, resilience } = input
  const age = ageFromBirth(profile.birthDate, now)
  const allG = group(results)
  const combineG = group(results.filter((r) => (r.source ?? "combine") === "combine"))

  const out: AttributeRating[] = []
  for (const attr of Object.keys(ATTRIBUTE_LABELS) as AttributeKey[]) {
    const Rall = makeRateFn(allG, profile, age)
    const Rcombine = makeRateFn(combineG, profile, age)

    // Confidence from the number/spread of tests behind this attribute.
    const attrKeys = Object.values(TEST_CATALOG).filter((d) => d.attribute === attr).map((d) => d.key)
    const dates = attrKeys.flatMap((k) => (allG.get(k) ?? []).map((r) => r.measuredAt?.getTime() ?? now.getTime()))
    const testCount = attrKeys.reduce((n, k) => n + Math.min(1, (allG.get(k)?.length ?? 0)), 0)
    const spanWeeks = dates.length >= 2 ? (Math.max(...dates) - Math.min(...dates)) / (7 * 24 * 3600 * 1000) : 0
    const conf = confidenceFor(testCount, spanWeeks, resilience.hasSixMonthHistory)

    let midpoint: number | null
    let subs: SubRating[]
    if (attr === "resilience") {
      const noData =
        resilience.trainingDaysTrailing12wk === 0 &&
        !resilience.hasSixMonthHistory &&
        resilience.symmetryRating == null &&
        resilience.injurySessionsLost === 0
      if (noData) {
        // Absence of logs is not evidence of poor durability — assume the median
        // until there's history to earn (or lose) it. Resilience is the slowest
        // rating to move by design, capped at 75 without six months of data.
        out.push(coldStart(attr))
        continue
      }
      const res = resilienceRating(resilience)
      midpoint = res.rating
      subs = res.subs
    } else {
      midpoint = headlineFor(attr, Rall)
      subs = subRatingsFor(attr, Rall, allG)
    }

    if (midpoint == null) {
      // No evidence yet — cold-start lower bound.
      out.push(coldStart(attr))
      continue
    }

    // Verified ceiling + provisional lift.
    const verified = input.verifiedCeilings?.[attr] ?? (attr === "resilience" ? null : headlineFor(attr, Rcombine))
    let capped = midpoint
    if (verified != null) capped = Math.min(midpoint, verified + conf.band)
    const provisional = verified != null ? Math.max(0, capped - verified) : 0

    // Hard gate.
    const gate = capFor(attr, allG, resilience.hasSixMonthHistory)
    if (gate) capped = Math.min(capped, gate.cap)

    const lower = capped - conf.band
    const upper = Math.min(99, capped + conf.band)
    const display = Math.min(gate ? gate.cap : 99, displayValue(capped, conf))

    out.push({
      key: attr,
      label: ATTRIBUTE_LABELS[attr],
      rating: roundRating(capped),
      displayRating: roundRating(display),
      lower: roundRating(lower),
      upper: roundRating(upper),
      rank: rankFor(roundRating(display)),
      confidence: conf,
      cap: gate?.cap ?? null,
      capReason: gate?.reason ?? null,
      verifiedCeiling: verified != null ? roundRating(verified) : null,
      provisional: Math.round(provisional * 10) / 10,
      testCount,
      subRatings: subs,
      evidence: evidenceFor(attr, allG, profile, age),
    })
  }
  return out
}

function coldStart(attr: AttributeKey): AttributeRating {
  const conf = confidenceFor(0, 0, false)
  const mid = 62 // the average adult is C rank on day one, before doing anything
  // Show the median with a wide band, not a pessimistic lower bound — the band
  // (54–70) carries the uncertainty; the headline stays honestly at the median.
  return {
    key: attr,
    label: ATTRIBUTE_LABELS[attr],
    rating: mid,
    displayRating: mid,
    lower: roundRating(mid - conf.band),
    upper: roundRating(mid + conf.band),
    rank: rankFor(mid),
    confidence: conf,
    cap: null,
    capReason: null,
    verifiedCeiling: null,
    provisional: 0,
    testCount: 0,
    subRatings: [],
    evidence: [],
  }
}

function evidenceFor(attr: AttributeKey, g: Grouped, profile: Profile, age: number): EvidenceItem[] {
  const items: EvidenceItem[] = []
  for (const def of Object.values(TEST_CATALOG)) {
    if (def.attribute !== attr) continue
    const r = latest(g, def.key)
    if (!r) continue
    const population = def.populationDefault === "trained" ? "trained" : "human"
    const rating = rateTest({
      def,
      value: r.value,
      bodyweightKg: r.bodyweightKg ?? profile.bodyweightKg,
      age,
      sex: profile.sex,
      population,
    })
    items.push({
      testKey: def.key,
      label: def.label,
      value: def.relative && (r.bodyweightKg ?? profile.bodyweightKg)
        ? Math.round((r.value / (r.bodyweightKg ?? profile.bodyweightKg)!) * 100) / 100
        : r.value,
      unit: def.unit,
      rating: roundRating(rating),
      measuredAt: r.measuredAt ?? new Date(),
      source: r.source ?? "combine",
      population: def.populationDefault,
      note: def.note,
    })
  }
  return items
}

// re-export label helper for consumers
export { SUB_LABELS } from "./attributes"
