import { populationRating, rankFor, roundRating, spliceRating, zScore, type CeilingAnchors } from "./curve"
import type { Sex } from "./types"

// ─────────────────────────────────────────────
// THE TRAINING SESSION LAYER (spec Part 9)
// Two numbers on every set, in the two seconds after it ends:
//   RANK    — population-referenced through the same curve as everything else.
//   BALANCE — the residual: the gap between what this movement should be (from
//             your anchor lifts via known strength ratios) and what it is.
// Never show a rank you can't defend: for movements outside the well-normed
// set, show Balance only and suppress Rank.
// ─────────────────────────────────────────────

export type StrengthNorm = {
  humanMean: number
  humanSd: number
  trainedMean: number
  trainedSd: number
  anchors: CeilingAnchors
}

export type ExerciseDef = {
  key: string
  label: string
  /** which anchor lift predicts this movement, and at what fraction */
  anchorKey: string
  ratioToAnchor: number
  /** present only for the well-normed movements RANK can defend */
  norm?: StrengthNorm
}

// Anchor lifts predict everything else. Ratios are typical trained-athlete
// relationships (a bench is ~60% of a trap-bar pull, a split squat ~50%, etc.).
export const EXERCISE_CATALOG: Record<string, ExerciseDef> = {
  trap_bar_deadlift: {
    key: "trap_bar_deadlift", label: "Trap-bar deadlift", anchorKey: "trap_bar_deadlift", ratioToAnchor: 1,
    norm: { humanMean: 1.3, humanSd: 0.5, trainedMean: 2.0, trainedSd: 0.5, anchors: { v81: 2.75, v90: 3.6, v99: 4.5 } },
  },
  back_squat: {
    key: "back_squat", label: "Back squat", anchorKey: "trap_bar_deadlift", ratioToAnchor: 0.85,
    norm: { humanMean: 1.0, humanSd: 0.4, trainedMean: 1.6, trainedSd: 0.4, anchors: { v81: 2.0, v90: 2.75, v99: 3.3 } },
  },
  front_squat: {
    key: "front_squat", label: "Front squat", anchorKey: "trap_bar_deadlift", ratioToAnchor: 0.68,
    norm: { humanMean: 0.8, humanSd: 0.35, trainedMean: 1.3, trainedSd: 0.35, anchors: { v81: 1.7, v90: 2.2, v99: 2.7 } },
  },
  bench_press: {
    key: "bench_press", label: "Bench press", anchorKey: "bench_press", ratioToAnchor: 1,
    norm: { humanMean: 0.9, humanSd: 0.35, trainedMean: 1.4, trainedSd: 0.35, anchors: { v81: 1.75, v90: 2.2, v99: 2.8 } },
  },
  overhead_press: {
    key: "overhead_press", label: "Overhead press", anchorKey: "bench_press", ratioToAnchor: 0.62,
    norm: { humanMean: 0.55, humanSd: 0.2, trainedMean: 0.85, trainedSd: 0.2, anchors: { v81: 1.1, v90: 1.35, v99: 1.6 } },
  },
  weighted_pullup: {
    key: "weighted_pullup", label: "Weighted pull-up", anchorKey: "weighted_pullup", ratioToAnchor: 1,
    norm: { humanMean: 0.9, humanSd: 0.35, trainedMean: 1.3, trainedSd: 0.3, anchors: { v81: 1.75, v90: 2.1, v99: 2.6 } },
  },
  // Balance-only accessories (no defensible population norm).
  bulgarian_split_squat: { key: "bulgarian_split_squat", label: "Bulgarian split squat", anchorKey: "trap_bar_deadlift", ratioToAnchor: 0.5 },
  romanian_deadlift: { key: "romanian_deadlift", label: "Romanian deadlift", anchorKey: "trap_bar_deadlift", ratioToAnchor: 0.72 },
  barbell_row: { key: "barbell_row", label: "Barbell row", anchorKey: "bench_press", ratioToAnchor: 0.9 },
  incline_press: { key: "incline_press", label: "Incline press", anchorKey: "bench_press", ratioToAnchor: 0.82 },
  hip_thrust: { key: "hip_thrust", label: "Hip thrust", anchorKey: "trap_bar_deadlift", ratioToAnchor: 1.1 },
}

export function getExercise(key: string): ExerciseDef | undefined {
  return EXERCISE_CATALOG[key]
}

/** Epley one-rep-max estimate from a clean rep set. Never a true single. */
export function epley(loadKg: number, reps: number): number {
  return loadKg * (1 + reps / 30)
}

function rateRatio(ratio: number, norm: StrengthNorm, population: "human" | "trained"): number {
  const mean = population === "trained" ? norm.trainedMean : norm.humanMean
  const sd = population === "trained" ? norm.trainedSd : norm.humanSd
  const z = zScore(ratio, mean, sd, "higher")
  return spliceRating(populationRating(z), norm.anchors, ratio)
}

export type SetInput = {
  exerciseKey: string
  reps: number
  loadKg: number
  bodyweightKg: number
}

export type SetRating = {
  rank: number | null
  rankLetter: string | null
  /** BALANCE residual in rating points (negative = lagging your anchors) */
  balance: number | null
  balanceLabel: string | null
  e1rm: number
  ratio: number
  isPr: boolean
  postSetLine: string
  suppressedRankReason: string | null
}

export type SetContext = {
  /** athlete anchor-lift e1RMs (kg) from their latest verified strength tests */
  anchorE1RMs: Record<string, number>
  previousBestE1RM?: number
  /** rank rating at this exercise from the previous session, for the delta */
  previousRank?: number | null
  sex: Sex
}

export function rateSet(input: SetInput, ctx: SetContext): SetRating {
  const def = getExercise(input.exerciseKey)
  const e1rm = epley(input.loadKg, input.reps)
  const ratio = input.bodyweightKg > 0 ? e1rm / input.bodyweightKg : 0
  const isPr = ctx.previousBestE1RM != null ? e1rm > ctx.previousBestE1RM + 0.5 : false

  let rank: number | null = null
  let rankLetter: string | null = null
  let suppressedRankReason: string | null = null

  if (def?.norm) {
    rank = roundRating(rateRatio(ratio, def.norm, "human"))
    rankLetter = rankFor(rank).letter
  } else {
    suppressedRankReason = "No defensible population norm for this movement — Balance only."
  }

  // BALANCE: predicted e1RM from the anchor lift × the known ratio.
  let balance: number | null = null
  let balanceLabel: string | null = null
  if (def) {
    const anchorE1RM = ctx.anchorE1RMs[def.anchorKey]
    if (anchorE1RM && def.anchorKey !== def.key) {
      const predicted = anchorE1RM * def.ratioToAnchor
      if (predicted > 0) {
        const pct = e1rm / predicted - 1
        balance = Math.max(-15, Math.min(15, Math.round(pct * 40)))
        const anchorLabel = EXERCISE_CATALOG[def.anchorKey]?.label.toLowerCase() ?? "anchor lift"
        balanceLabel = balance === 0 ? `in line with your ${anchorLabel}` : `${balance < 0 ? "behind" : "ahead of"} your ${anchorLabel}`
      }
    } else if (def.anchorKey === def.key) {
      balanceLabel = "anchor lift — sets the baseline"
    }
  }

  // Post-set line: rank, delta, PR flag — one line, no modal.
  const parts: string[] = []
  const label = def?.label ?? input.exerciseKey
  if (rank != null) {
    parts.push(`${label} — ${rankLetter} (${rank})`)
    if (ctx.previousRank != null) {
      const d = rank - ctx.previousRank
      if (d !== 0) parts.push(`${d > 0 ? "+" : ""}${d} from last session`)
    }
  } else if (balance != null) {
    parts.push(`${label} — Balance ${balance >= 0 ? "+" : ""}${balance}`)
  } else {
    parts.push(label)
  }
  if (isPr) parts.push("best at this bodyweight ✓")

  return {
    rank,
    rankLetter,
    balance,
    balanceLabel,
    e1rm: Math.round(e1rm * 10) / 10,
    ratio: Math.round(ratio * 100) / 100,
    isPr,
    postSetLine: parts.join(" · "),
    suppressedRankReason,
  }
}
