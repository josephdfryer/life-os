import { ageDecline, sexAdjust } from "./norms"
import type { AttributeKey, NormContext, NormParams, TestDefinition } from "./types"

// ─────────────────────────────────────────────
// THE MEASUREMENT CATALOG
//
// Every rated input in the battery, with its protocol, its norms, and (where
// the elite tail matters) its ceiling anchors. Norm means are calibrated so the
// spec's worked examples reproduce: a 20" vertical is a 62, a 30" vertical is
// an 81, a 284 ms reaction is a 62, and so on. Age adjustment past 30 is
// modeled and flagged; sex adjustment is coarse and flagged.
// ─────────────────────────────────────────────

const MODELED = true

/** peak-referenced physical norm with modeled age decline */
function phys(
  peakMean: number,
  sd: number,
  rate: number,
  dir: "higher" | "lower",
  kind: Parameters<typeof sexAdjust>[2],
): (ctx: NormContext) => NormParams {
  return (ctx) => {
    const mean = sexAdjust(ageDecline(peakMean, ctx.age, rate, dir), ctx.sex, kind)
    return { mean, sd, modeled: ctx.age > 30 }
  }
}

/** a test with distinct general-population and trained-population norms */
function dual(
  human: (ctx: NormContext) => NormParams,
  trained: (ctx: NormContext) => NormParams,
): (ctx: NormContext) => NormParams | null {
  return (ctx) => (ctx.population === "trained" ? trained(ctx) : human(ctx))
}

export const TEST_CATALOG: Record<string, TestDefinition> = {
  // ── 1. STRENGTH ──────────────────────────────
  grip: {
    key: "grip",
    label: "Grip (dynamometer)",
    attribute: "strength",
    sub: "grip",
    unit: "kg",
    direction: "higher",
    populationDefault: "general",
    norm: phys(51, 9, 0.008, "higher", "grip"),
    anchors: { v81: 62, v90: 78, v99: 90 },
    protocol: ["best-of-3", "elbow-90"],
    note: "The only strength measure with clean general-population norms — it anchors the Human rating.",
  },
  trap_bar_dl: {
    key: "trap_bar_dl",
    label: "Trap-bar deadlift e1RM",
    attribute: "strength",
    sub: "relativeStrength",
    unit: "× bodyweight",
    direction: "higher",
    relative: true,
    populationDefault: "trained",
    norm: dual(
      () => ({ mean: 1.3, sd: 0.5, modeled: MODELED }),
      () => ({ mean: 2.0, sd: 0.5, modeled: MODELED }),
    ),
    anchors: { v81: 2.75, v90: 3.6, v99: 4.5 },
    protocol: ["trap-bar", "e1rm-from-3-5"],
    note: "Trap bar, never straight bar — same information, materially less spinal compression.",
  },
  weighted_pullup: {
    key: "weighted_pullup",
    label: "Weighted pull-up e1RM",
    attribute: "strength",
    sub: "relativeStrength",
    unit: "× bodyweight (total)",
    direction: "higher",
    relative: true,
    populationDefault: "trained",
    norm: dual(
      () => ({ mean: 0.9, sd: 0.35, modeled: MODELED }),
      () => ({ mean: 1.3, sd: 0.3, modeled: MODELED }),
    ),
    anchors: { v81: 1.75, v90: 2.1, v99: 2.6 },
  },
  bench_press: {
    key: "bench_press",
    label: "Push e1RM (bench / weighted dip)",
    attribute: "strength",
    sub: "absoluteStrength",
    unit: "× bodyweight",
    direction: "higher",
    relative: true,
    populationDefault: "trained",
    norm: dual(
      () => ({ mean: 0.9, sd: 0.35, modeled: MODELED }),
      () => ({ mean: 1.4, sd: 0.35, modeled: MODELED }),
    ),
    anchors: { v81: 1.75, v90: 2.2, v99: 2.8 },
  },

  // ── 2. POWER ─────────────────────────────────
  vertical_cmj: {
    key: "vertical_cmj",
    label: "Countermovement jump (arms)",
    attribute: "power",
    sub: "verticalPower",
    unit: "in",
    direction: "higher",
    populationDefault: "general",
    norm: phys(20, 4, 0.012, "higher", "jump"),
    anchors: { v81: 30, v90: 40, v99: 46 },
    protocol: ["countermovement", "arms"],
    note: "CMJ reads 2–4″ higher than a squat jump; arm swing adds 3–6″. Protocol must match the norm.",
  },
  squat_jump: {
    key: "squat_jump",
    label: "Squat jump (no arms, no dip)",
    attribute: "power",
    unit: "in",
    direction: "higher",
    populationDefault: "general",
    norm: phys(16, 4, 0.012, "higher", "jump"),
    anchors: { v81: 26, v90: 35, v99: 41 },
    protocol: ["no-countermovement", "hands-on-hips"],
  },
  broad_jump: {
    key: "broad_jump",
    label: "Standing broad jump",
    attribute: "power",
    unit: "cm",
    direction: "higher",
    populationDefault: "general",
    norm: phys(200, 25, 0.012, "higher", "jump"),
    anchors: { v81: 260, v90: 300, v99: 360 },
  },
  drop_jump_rsi: {
    key: "drop_jump_rsi",
    label: "Drop-jump RSI (30 cm)",
    attribute: "power",
    sub: "reactiveStrength",
    unit: "RSI",
    direction: "higher",
    populationDefault: "general",
    norm: phys(1.2, 0.4, 0.012, "higher", "jump"),
    anchors: { v81: 2.0, v90: 2.8, v99: 3.5 },
  },

  // ── 3. SPEED ─────────────────────────────────
  flying10_velocity: {
    key: "flying10_velocity",
    label: "Flying-10 velocity",
    attribute: "speed",
    sub: "maxVelocity",
    unit: "m/s",
    direction: "higher",
    populationDefault: "general",
    norm: phys(7.0, 1.0, 0.012, "higher", "speed"),
    anchors: { v81: 9.5, v90: 11.2, v99: 12.4 },
    protocol: ["fly-in-20m", "120fps"],
    note: "Primary over a 40yd dash — safer on a knee, and it isolates top speed from start technique.",
  },
  sprint_10m: {
    key: "sprint_10m",
    label: "10 m from a standstill",
    attribute: "speed",
    unit: "s",
    direction: "lower",
    populationDefault: "general",
    norm: phys(1.9, 0.15, 0.012, "lower", "speed"),
    protocol: ["120fps"],
  },
  sprint_40m_decay: {
    key: "sprint_40m_decay",
    label: "40 m split decay (20–40 vs 0–20)",
    attribute: "speed",
    unit: "%",
    direction: "lower",
    populationDefault: "general",
    norm: () => ({ mean: 8, sd: 4, modeled: true }),
  },

  // ── 4. AGILITY ───────────────────────────────
  shuttle_5_10_5: {
    key: "shuttle_5_10_5",
    label: "5-10-5 shuttle (planned)",
    attribute: "agility",
    sub: "changeOfDirection",
    unit: "s",
    direction: "lower",
    populationDefault: "general",
    norm: phys(5.4, 0.32, 0.01, "lower", "speed"),
    anchors: { v81: 4.6, v90: 4.1, v99: 3.8 },
    protocol: ["best-of-3", "turf"],
  },
  reactive_shuttle: {
    key: "reactive_shuttle",
    label: "Reactive shuttle (cue at the whistle)",
    attribute: "agility",
    unit: "s",
    direction: "lower",
    populationDefault: "general",
    norm: phys(5.8, 0.4, 0.01, "lower", "speed"),
    protocol: ["reactive-cue", "turf"],
    note: "The gap between planned and reactive is where real movement skill lives — and it gates Agility above 79.",
  },
  test_505: {
    key: "test_505",
    label: "505 (single 180° cut)",
    attribute: "agility",
    sub: "deceleration",
    unit: "s",
    direction: "lower",
    populationDefault: "general",
    norm: phys(2.6, 0.25, 0.01, "lower", "speed"),
  },
  shuttle_lr_delta: {
    key: "shuttle_lr_delta",
    label: "L/R shuttle delta",
    attribute: "agility",
    sub: "symmetry",
    unit: "%",
    direction: "lower",
    populationDefault: "general",
    norm: () => ({ mean: 4, sd: 3, modeled: true }),
  },

  // ── 5. ENGINE ────────────────────────────────
  vo2max: {
    key: "vo2max",
    label: "VO2max",
    attribute: "engine",
    sub: "aerobicCapacity",
    unit: "ml/kg/min",
    direction: "higher",
    populationDefault: "general",
    // ACSM/FRIEND-shaped: peak ~46 at 25, declines ~0.9%/yr. Male 40–49 ≈ 38.
    norm: (ctx) => ({
      mean: sexAdjust(ageDecline(46, ctx.age, 0.009, "higher"), ctx.sex, "vo2"),
      sd: 8,
      modeled: ctx.age > 30,
    }),
    anchors: { v81: 58, v90: 80, v99: 96 },
    note: "A wearable estimate runs 5–10% off lab values and cannot lift Engine above 81 (see caps).",
  },
  run_5k_wma: {
    key: "run_5k_wma",
    label: "Age-graded 5k (WMA %)",
    attribute: "engine",
    sub: "threshold",
    unit: "% WMA",
    direction: "higher",
    wma: true,
    populationDefault: "general",
    norm: () => null, // WMA maps straight to a rating; no z needed
    note: "The one test where the top-band scale comes free and exact — WMA maintains the table.",
  },
  hr_recovery_60s: {
    key: "hr_recovery_60s",
    label: "HR recovery, 60 s",
    attribute: "engine",
    sub: "hrRecovery",
    unit: "bpm",
    direction: "higher",
    populationDefault: "general",
    norm: () => ({ mean: 25, sd: 10, modeled: true }),
  },

  // ── 6. WORK CAPACITY ─────────────────────────
  pushups_max: {
    key: "pushups_max",
    label: "Push-ups to failure",
    attribute: "workCapacity",
    unit: "reps",
    direction: "higher",
    populationDefault: "general",
    norm: phys(19, 8, 0.01, "higher", "generic"),
    anchors: { v81: 40, v90: 60, v99: 80 },
    note: "40+ tracks dramatically lower cardiovascular risk (Harvard 2019) — this number means something outside the game.",
  },
  dead_hang: {
    key: "dead_hang",
    label: "Dead hang",
    attribute: "workCapacity",
    unit: "s",
    direction: "higher",
    populationDefault: "general",
    norm: phys(45, 25, 0.01, "higher", "generic"),
    anchors: { v81: 120, v90: 180, v99: 240 },
  },
  repeat_sprint_decay: {
    key: "repeat_sprint_decay",
    label: "Repeated-sprint decay (6×30 m)",
    attribute: "workCapacity",
    sub: "repeatEffort",
    unit: "%",
    direction: "lower",
    populationDefault: "general",
    norm: () => ({ mean: 10, sd: 4, modeled: true }),
  },
  plank: {
    key: "plank",
    label: "Plank hold",
    attribute: "workCapacity",
    unit: "s",
    direction: "higher",
    populationDefault: "general",
    norm: phys(90, 45, 0.008, "higher", "generic"),
    anchors: { v81: 240, v90: 360, v99: 600 },
  },

  // ── 7. MOBILITY ──────────────────────────────
  sit_and_reach: {
    key: "sit_and_reach",
    label: "Sit-and-reach",
    attribute: "mobility",
    sub: "hip",
    unit: "cm past toes",
    direction: "higher",
    populationDefault: "general",
    norm: () => ({ mean: 2, sd: 8, modeled: true }),
  },
  knee_to_wall_l: {
    key: "knee_to_wall_l",
    label: "Knee-to-wall (left)",
    attribute: "mobility",
    sub: "ankle",
    unit: "cm",
    direction: "higher",
    populationDefault: "general",
    norm: () => ({ mean: 10, sd: 3, modeled: true }),
    note: "10–12 cm healthy; under 8 cm is a real limiter.",
  },
  knee_to_wall_r: {
    key: "knee_to_wall_r",
    label: "Knee-to-wall (right)",
    attribute: "mobility",
    sub: "ankle",
    unit: "cm",
    direction: "higher",
    populationDefault: "general",
    norm: () => ({ mean: 10, sd: 3, modeled: true }),
  },
  shoulder_reach: {
    key: "shoulder_reach",
    label: "Shoulder reach (fingertip gap)",
    attribute: "mobility",
    sub: "shoulder",
    unit: "cm gap",
    direction: "lower",
    populationDefault: "general",
    norm: () => ({ mean: 5, sd: 8, modeled: true }),
  },
  deep_squat_hold: {
    key: "deep_squat_hold",
    label: "Deep squat hold",
    attribute: "mobility",
    sub: "hip",
    unit: "s",
    direction: "higher",
    populationDefault: "general",
    norm: () => ({ mean: 60, sd: 45, modeled: true }),
  },

  // ── 8. CONTROL ───────────────────────────────
  single_leg_stance_ec: {
    key: "single_leg_stance_ec",
    label: "Single-leg stance, eyes closed",
    attribute: "control",
    sub: "staticBalance",
    unit: "s",
    direction: "higher",
    populationDefault: "general",
    // Springer normative study, 18–39 mean 13.1 s, no sex difference.
    norm: (ctx) => ({ mean: ageDecline(13.1, ctx.age, 0.02, "higher"), sd: 7, modeled: ctx.age > 39 }),
    anchors: { v81: 30, v90: 45, v99: 60 },
    note: "10+ seconds is independently associated with lower all-cause mortality — the cheapest test with the strongest outcome literature.",
  },
  y_balance: {
    key: "y_balance",
    label: "Y-balance composite (normalized)",
    attribute: "control",
    sub: "dynamicBalance",
    unit: "%",
    direction: "higher",
    populationDefault: "general",
    norm: () => ({ mean: 95, sd: 10, modeled: true }),
  },
  drop_landing_score: {
    key: "drop_landing_score",
    label: "Drop-landing control (0–100)",
    attribute: "control",
    sub: "landingControl",
    unit: "score",
    direction: "higher",
    populationDefault: "general",
    norm: () => ({ mean: 60, sd: 15, modeled: true }),
    note: "Feeds hardest into injury-risk flags — and a phone scores knee valgus better than the eye.",
  },
  nine_hole_peg: {
    key: "nine_hole_peg",
    label: "9-hole peg (dominant hand)",
    attribute: "control",
    sub: "fineMotor",
    unit: "s",
    direction: "lower",
    populationDefault: "general",
    norm: () => ({ mean: 19.5, sd: 2.5, modeled: false }),
    note: "NIH Toolbox norm: men 16–39 complete it in 19–20 s.",
  },

  // ── 9. REACTION ──────────────────────────────
  simple_rt: {
    key: "simple_rt",
    label: "Simple visual reaction time",
    attribute: "reaction",
    sub: "latency",
    unit: "ms",
    direction: "lower",
    populationDefault: "general",
    norm: (ctx) => ({ mean: ageDecline(284, ctx.age, 0.004, "lower"), sd: 45, modeled: ctx.age > 30 }),
    clampMin: 150,
    clampMax: 800,
    note: "Browser tests read 20–40 ms slow. The engine stores the device fingerprint and refuses cross-hardware comparison.",
  },
  rt_variance: {
    key: "rt_variance",
    label: "Reaction-time variance (SD of trials)",
    attribute: "reaction",
    sub: "consistency",
    unit: "ms",
    direction: "lower",
    populationDefault: "general",
    norm: () => ({ mean: 60, sd: 25, modeled: true }),
    note: "Elite performers aren't only fast, they're stable. A wide spread is a worse finding than a flat mean.",
  },
  choice_rt: {
    key: "choice_rt",
    label: "Choice reaction time",
    attribute: "reaction",
    unit: "ms",
    direction: "lower",
    populationDefault: "general",
    norm: () => ({ mean: 420, sd: 60, modeled: true }),
  },
}

export const CATALOG_BY_ATTRIBUTE: Record<AttributeKey, TestDefinition[]> = Object.values(
  TEST_CATALOG,
).reduce((acc, def) => {
  ;(acc[def.attribute] ||= []).push(def)
  return acc
}, {} as Record<AttributeKey, TestDefinition[]>)

export function getTest(key: string): TestDefinition | undefined {
  return TEST_CATALOG[key]
}
