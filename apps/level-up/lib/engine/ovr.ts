import { OVR_WEIGHTS } from "./attributes"
import type { AttributeKey, AttributeRating } from "./types"

// ─────────────────────────────────────────────
// OVR & BUILDS (spec Part 5)
// One score can't describe a person, so ship several and make the primary one
// a choice. Every build keeps Mobility and Resilience mandatory — in the real
// world the weak link is what breaks.
// ─────────────────────────────────────────────

export type BuildKey = "general" | "power" | "endurance" | "tactical" | "allAround"

export type BuildDef = {
  key: BuildKey
  label: string
  blurb: string
  weights: Record<AttributeKey, number>
  /** multiplier on the weak-link penalty */
  weakLinkMult: number
}

function normalizeWeights(w: Partial<Record<AttributeKey, number>>): Record<AttributeKey, number> {
  const keys = Object.keys(OVR_WEIGHTS) as AttributeKey[]
  const full = keys.reduce((acc, k) => ((acc[k] = w[k] ?? 0), acc), {} as Record<AttributeKey, number>)
  const total = keys.reduce((a, k) => a + full[k], 0) || 1
  keys.forEach((k) => (full[k] = full[k] / total))
  return full
}

export const BUILDS: Record<BuildKey, BuildDef> = {
  general: {
    key: "general",
    label: "General Athletic",
    blurb: "The honest, balanced OVR.",
    weights: { ...OVR_WEIGHTS },
    weakLinkMult: 1,
  },
  power: {
    key: "power",
    label: "Power Athlete",
    blurb: "Strength, Power and Speed dominate; Engine de-weighted. Mobility and Resilience stay mandatory.",
    weights: normalizeWeights({
      strength: 0.2, power: 0.22, speed: 0.18, agility: 0.1, engine: 0.03,
      resilience: 0.08, workCapacity: 0.04, control: 0.06, mobility: 0.06, reaction: 0.03,
    }),
    weakLinkMult: 1,
  },
  endurance: {
    key: "endurance",
    label: "Endurance Athlete",
    blurb: "Engine, Work Capacity and Resilience dominate; maximal strength de-weighted.",
    weights: normalizeWeights({
      engine: 0.28, workCapacity: 0.2, resilience: 0.16, speed: 0.06, agility: 0.05,
      power: 0.05, strength: 0.05, mobility: 0.07, control: 0.05, reaction: 0.03,
    }),
    weakLinkMult: 1,
  },
  tactical: {
    key: "tactical",
    label: "Tactical Athlete",
    blurb: "Work Capacity, Resilience, Strength and Agility, near-flat. Heaviest weak-link penalty.",
    weights: normalizeWeights({
      workCapacity: 0.16, resilience: 0.16, strength: 0.14, agility: 0.12, engine: 0.12,
      power: 0.08, speed: 0.08, mobility: 0.06, control: 0.05, reaction: 0.03,
    }),
    weakLinkMult: 2,
  },
  allAround: {
    key: "allAround",
    label: "All-Around",
    blurb: "Balanced, with the weak-link penalty tripled.",
    weights: { ...OVR_WEIGHTS },
    weakLinkMult: 3,
  },
}

/** Weak-link penalty: 1 point per attribute below 50, doubled for the two
 * injury gates (Mobility, Resilience), then scaled by the build multiplier. */
export function weakLinkPenalty(ratings: Record<AttributeKey, number>, mult: number): number {
  let penalty = 0
  for (const key of Object.keys(ratings) as AttributeKey[]) {
    if (ratings[key] < 50) {
      penalty += key === "mobility" || key === "resilience" ? 2 : 1
    }
  }
  return penalty * mult
}

export function ovrFromRatingMap(map: Record<AttributeKey, number>, build: BuildDef): number {
  const base = (Object.keys(build.weights) as AttributeKey[]).reduce(
    (sum, k) => sum + (map[k] ?? 62) * build.weights[k],
    0,
  )
  return Math.round(base - weakLinkPenalty(map, build.weakLinkMult))
}

export function ovrForBuild(attrs: AttributeRating[], build: BuildDef): number {
  const map = attrs.reduce((acc, a) => ((acc[a.key] = a.rating), acc), {} as Record<AttributeKey, number>)
  return ovrFromRatingMap(map, build)
}

export function allBuildOvrs(attrs: AttributeRating[]): Record<BuildKey, number> {
  return (Object.keys(BUILDS) as BuildKey[]).reduce((acc, k) => {
    acc[k] = ovrForBuild(attrs, BUILDS[k])
    return acc
  }, {} as Record<BuildKey, number>)
}

// ── Target builds (spec Part 5) ─────────────────────────────────────
// Turn a goal into a character sheet: pick a target, see the deltas.
export type TargetTemplate = {
  key: string
  label: string
  blurb: string
  /** requirement keyed by attribute (headline) */
  requirements: Partial<Record<AttributeKey, number>>
}

export const TARGET_TEMPLATES: TargetTemplate[] = [
  {
    key: "dunking_wing",
    label: "Dunking Wing",
    blurb: "At 5'10\", a clean rim touch is a 29–31\" vertical — the 50th percentile to the 99th. A real 12–18 month project rendered as twenty visible points.",
    requirements: { power: 84, strength: 82, speed: 78, control: 75, resilience: 72, mobility: 70 },
  },
  {
    key: "sub20_5k",
    label: "Sub-20 5k",
    blurb: "A big aerobic engine with the durability to train it consistently.",
    requirements: { engine: 84, workCapacity: 78, resilience: 76, mobility: 66 },
  },
  {
    key: "tactical_ready",
    label: "Tactical Ready",
    blurb: "Pass any fitness selection with margin: broad, durable, no weak link.",
    requirements: { strength: 75, engine: 75, workCapacity: 78, agility: 72, resilience: 76, mobility: 70 },
  },
]

export type TargetDelta = {
  attribute: AttributeKey
  current: number
  required: number
  gap: number
}

export function targetDeltas(
  attrs: AttributeRating[],
  requirements: Partial<Record<AttributeKey, number>>,
): TargetDelta[] {
  const map = attrs.reduce((acc, a) => ((acc[a.key] = a.rating), acc), {} as Record<AttributeKey, number>)
  return (Object.keys(requirements) as AttributeKey[])
    .map((attribute) => {
      const required = requirements[attribute]!
      const current = map[attribute] ?? 62
      return { attribute, current, required, gap: Math.max(0, required - current) }
    })
    .sort((a, b) => b.gap - a.gap)
}

/** Archetype auto-detection for the reveal screen ("NEW ARCHETYPE"). Picks the
 * build the athlete currently scores highest on, relative to its typical spread. */
export function detectArchetype(buildOvrs: Record<BuildKey, number>): { key: BuildKey; label: string } {
  const specialized = (Object.keys(buildOvrs) as BuildKey[]).filter((k) => k !== "general" && k !== "allAround")
  let best: BuildKey = "general"
  let bestVal = -Infinity
  for (const k of specialized) {
    if (buildOvrs[k] > bestVal) {
      bestVal = buildOvrs[k]
      best = k
    }
  }
  // If nothing stands out above general, they're a generalist.
  if (bestVal <= buildOvrs.general + 1) best = "general"
  return { key: best, label: BUILDS[best].label }
}
