import type { AttributeKey, AttributeRating, SubRating } from "./types"

// ─────────────────────────────────────────────
// BADGES (spec Part 6)
// Ratings say how good you are; badges say HOW you're good. Every badge is tied
// to a residual or a hard threshold — none are decorative. A 71 Speed with
// Quick First Step Gold is a different athlete from a 71 Speed with Second Gear
// Gold, and no single number will ever say so.
// ─────────────────────────────────────────────

export type BadgeTier = "bronze" | "silver" | "gold" | "hof"
export const TIER_LABEL: Record<BadgeTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  hof: "Hall of Fame",
}

export type BadgeCriterion = { label: string; met: boolean; value?: string }
export type BadgeState = {
  key: string
  label: string
  description: string
  unlocked: boolean
  tier: BadgeTier | null
  /** progress toward the next tier, 0..1 */
  progress: number
  nextTier: BadgeTier | null
  criteria: BadgeCriterion[]
}

export type BadgeContext = {
  attrs: AttributeRating[]
  /** latest raw values by testKey */
  raw: Record<string, number | undefined>
  availabilityFrac: number
  availabilityWeeks: number
  testDayDeltaStreak: number // consecutive combines with positive test-day delta
}

function sub(ctx: BadgeContext, attr: AttributeKey, key: string): SubRating | undefined {
  return ctx.attrs.find((a) => a.key === attr)?.subRatings.find((s) => s.key === key)
}
function attrRating(ctx: BadgeContext, attr: AttributeKey): number {
  return ctx.attrs.find((a) => a.key === attr)?.rating ?? 0
}

/** Threshold ladder: pick the highest tier whose threshold is met, and progress
 * toward the next. `higher` controls direction (some metrics are "lower is
 * better"). */
function ladder(
  value: number | null | undefined,
  thresholds: Record<BadgeTier, number>,
  higher = true,
): { tier: BadgeTier | null; progress: number; nextTier: BadgeTier | null } {
  if (value == null) return { tier: null, progress: 0, nextTier: "bronze" }
  const order: BadgeTier[] = ["bronze", "silver", "gold", "hof"]
  const met = (t: BadgeTier) => (higher ? value >= thresholds[t] : value <= thresholds[t])
  let tier: BadgeTier | null = null
  for (const t of order) if (met(t)) tier = t
  const idx = tier ? order.indexOf(tier) : -1
  const next = order[idx + 1] ?? null
  let progress = 0
  if (next) {
    const lo = tier ? thresholds[tier] : higher ? value : value // baseline
    const hi = thresholds[next]
    progress = Math.max(0, Math.min(1, higher ? (value - lo) / (hi - lo || 1) : (lo - value) / (lo - hi || 1)))
  } else if (tier === "hof") progress = 1
  return { tier, progress, nextTier: next }
}

type BadgeDef = {
  key: string
  label: string
  description: string
  evaluate: (ctx: BadgeContext) => BadgeState
}

const BADGE_DEFS: BadgeDef[] = [
  {
    key: "quick_first_step",
    label: "Quick First Step",
    description: "Acceleration residual well above what your top speed predicts.",
    evaluate: (ctx) => {
      const s = sub(ctx, "speed", "acceleration")
      const rsd = s?.residualSd ?? null
      const l = ladder(rsd, { bronze: 1.0, silver: 1.5, gold: 2.0, hof: 2.5 })
      return badge("quick_first_step", "Quick First Step", "Acceleration residual well above what your top speed predicts.", l, [
        { label: "Acceleration residual ≥ +1 SD", met: (rsd ?? -9) >= 1, value: rsd != null ? `${rsd >= 0 ? "+" : ""}${rsd.toFixed(1)} SD` : "—" },
      ])
    },
  },
  {
    key: "second_gear",
    label: "Second Gear",
    description: "Speed holds when others fade — a positive maintenance residual.",
    evaluate: (ctx) => {
      const s = sub(ctx, "speed", "speedMaintenance")
      const rsd = s?.residualSd ?? null
      const l = ladder(rsd, { bronze: 1.0, silver: 1.5, gold: 2.0, hof: 2.5 })
      return badge("second_gear", "Second Gear", "Speed holds when others fade — a positive maintenance residual.", l, [
        { label: "Speed maintenance residual ≥ +1 SD", met: (rsd ?? -9) >= 1, value: rsd != null ? `${rsd.toFixed(1)} SD` : "—" },
      ])
    },
  },
  {
    key: "springs",
    label: "Springs",
    description: "Elastic power ≥ 20% and RSI ≥ 2.0 — a genuine stretch-shortening engine.",
    evaluate: (ctx) => {
      const elastic = sub(ctx, "power", "elasticPower")?.rating ?? null
      const rsi = ctx.raw["drop_jump_rsi"] ?? null
      const both = (elastic ?? 0) >= 77 && (rsi ?? 0) >= 2.0 // elastic rating ~77 ≈ 20% EUR
      const l = ladder(rsi, { bronze: 2.0, silver: 2.5, gold: 3.0, hof: 3.5 })
      const tier = both ? l.tier ?? "bronze" : null
      return badge("springs", "Springs", "Elastic power ≥ 20% and RSI ≥ 2.0 — a genuine stretch-shortening engine.", { ...l, tier }, [
        { label: "Elastic power ≥ 20%", met: (elastic ?? 0) >= 77 },
        { label: "RSI ≥ 2.0", met: (rsi ?? 0) >= 2.0, value: rsi != null ? rsi.toFixed(1) : "—" },
      ])
    },
  },
  {
    key: "iron_base",
    label: "Iron Base",
    description: "Relative strength ≥ 78 with symmetry under 5%.",
    evaluate: (ctx) => {
      const rel = sub(ctx, "strength", "relativeStrength")?.rating ?? null
      const symm = sub(ctx, "mobility", "symmetry")?.rating ?? null
      const symmetrical = symm == null ? true : symm >= 70 // ≥70 ≈ under 5% asymmetry
      const l = ladder(rel, { bronze: 78, silver: 84, gold: 90, hof: 95 })
      const tier = symmetrical ? l.tier : null
      return badge("iron_base", "Iron Base", "Relative strength ≥ 78 with symmetry under 5%.", { ...l, tier }, [
        { label: "Relative strength ≥ 78", met: (rel ?? 0) >= 78, value: rel != null ? String(rel) : "—" },
        { label: "Symmetry under 5%", met: symmetrical },
      ])
    },
  },
  {
    key: "motor",
    label: "Motor",
    description: "Repeated-sprint decay under 8%.",
    evaluate: (ctx) => {
      const decay = ctx.raw["repeat_sprint_decay"] ?? null
      const l = ladder(decay, { bronze: 8, silver: 6, gold: 4, hof: 2.5 }, false)
      return badge("motor", "Motor", "Repeated-sprint decay under 8%.", l, [
        { label: "Decay < 8%", met: (decay ?? 99) < 8, value: decay != null ? `${decay.toFixed(1)}%` : "—" },
      ])
    },
  },
  {
    key: "fast_recovery",
    label: "Fast Recovery",
    description: "60-second HR recovery ≥ 35 bpm.",
    evaluate: (ctx) => {
      const hr = ctx.raw["hr_recovery_60s"] ?? null
      const l = ladder(hr, { bronze: 35, silver: 45, gold: 55, hof: 65 })
      return badge("fast_recovery", "Fast Recovery", "60-second HR recovery ≥ 35 bpm.", l, [
        { label: "HR recovery ≥ 35 bpm", met: (hr ?? 0) >= 35, value: hr != null ? `${hr} bpm` : "—" },
      ])
    },
  },
  {
    key: "floor_general",
    label: "Floor General",
    description: "Control ≥ 75 and reactive agility residual ≥ +0.5 SD.",
    evaluate: (ctx) => {
      const control = attrRating(ctx, "control")
      const ra = sub(ctx, "agility", "reactiveAgility")?.residualSd ?? null
      const both = control >= 75 && (ra ?? -9) >= 0.5
      const l = ladder(control, { bronze: 75, silver: 80, gold: 85, hof: 90 })
      return badge("floor_general", "Floor General", "Control ≥ 75 and reactive agility residual ≥ +0.5 SD.", { ...l, tier: both ? l.tier ?? "bronze" : null }, [
        { label: "Control ≥ 75", met: control >= 75, value: String(control) },
        { label: "Reactive agility residual ≥ +0.5 SD", met: (ra ?? -9) >= 0.5, value: ra != null ? `${ra.toFixed(1)} SD` : "—" },
      ])
    },
  },
  {
    key: "unbreakable",
    label: "Unbreakable",
    description: "Availability ≥ 95% over 26 weeks.",
    evaluate: (ctx) => {
      const ok = ctx.availabilityFrac >= 0.95 && ctx.availabilityWeeks >= 26
      const l = ladder(ctx.availabilityFrac * 100, { bronze: 90, silver: 95, gold: 98, hof: 100 })
      return badge("unbreakable", "Unbreakable", "Availability ≥ 95% over 26 weeks.", { ...l, tier: ok ? l.tier ?? "silver" : null }, [
        { label: "Availability ≥ 95%", met: ctx.availabilityFrac >= 0.95, value: `${(ctx.availabilityFrac * 100).toFixed(0)}%` },
        { label: "Over 26 weeks", met: ctx.availabilityWeeks >= 26, value: `${ctx.availabilityWeeks} wk` },
      ])
    },
  },
  {
    key: "clutch_engine",
    label: "Clutch Engine",
    description: "Test-day delta positive across 3 consecutive combines.",
    evaluate: (ctx) => {
      const l = ladder(ctx.testDayDeltaStreak, { bronze: 3, silver: 4, gold: 5, hof: 6 })
      return badge("clutch_engine", "Clutch Engine", "Test-day delta positive across 3 consecutive combines.", l, [
        { label: "Positive test-day delta ×3", met: ctx.testDayDeltaStreak >= 3, value: `${ctx.testDayDeltaStreak} combines` },
      ])
    },
  },
]

function badge(
  key: string,
  label: string,
  description: string,
  l: { tier: BadgeTier | null; progress: number; nextTier: BadgeTier | null },
  criteria: BadgeCriterion[],
): BadgeState {
  return { key, label, description, unlocked: l.tier != null, tier: l.tier, progress: l.progress, nextTier: l.nextTier, criteria }
}

export function computeBadges(ctx: BadgeContext): BadgeState[] {
  return BADGE_DEFS.map((d) => d.evaluate(ctx))
}
