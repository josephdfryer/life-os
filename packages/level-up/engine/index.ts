import { ATTRIBUTE_ORDER, ATTRIBUTE_TAGLINE } from "./attributes"
import { computeAttributes, ageFromBirth, type ComputeInput, type ResilienceInputs } from "./aggregate"
import { computeBadges, type BadgeState } from "./badges"
import { rankFor, roundRating } from "./curve"
import { computeForm, FORM_NEUTRAL, type FormInputs, type FormResult } from "./form"
import {
  allBuildOvrs,
  BUILDS,
  detectArchetype,
  ovrFromRatingMap,
  targetDeltas,
  TARGET_TEMPLATES,
  type BuildKey,
  type TargetDelta,
} from "./ovr"
import type { AttributeKey, AttributeRating, Profile, TestResultInput } from "./types"

// ─────────────────────────────────────────────
// THE CARD
// One call that turns raw measurements + condition into everything the UI
// draws: ten ratings, an OVR you can re-weight, build OVRs, badges, form, and
// target-build deltas. The user interacts with this; the engine did the science.
// ─────────────────────────────────────────────

export type BehavioralPanel = {
  consistencyPct: number
  streakWeeks: number
  loadTolerance: "building" | "steady" | "at-risk" | "unknown"
  testDayDelta: number | null
  testDayDeltaStreak: number
  availabilityWeeks: number
}

export type CardTarget = {
  key: string
  label: string
  blurb?: string
  deltas: TargetDelta[]
  totalGap: number
  done: boolean
}

export type Card = {
  age: number
  attributes: AttributeRating[]
  ovr: number
  currentOvr: number
  primaryBuild: BuildKey
  buildOvrs: Record<BuildKey, number>
  archetype: { key: BuildKey; label: string }
  badges: BadgeState[]
  form: FormResult
  behavioral: BehavioralPanel
  targets: CardTarget[]
  hasAnyData: boolean
}

export type CardInput = {
  profile: Profile
  results: TestResultInput[]
  now?: Date
  verifiedCeilings?: Partial<Record<AttributeKey, number>>
  resilience?: Partial<ResilienceInputs>
  form?: FormInputs
  behavioral?: Partial<BehavioralPanel>
  /** target builds the athlete has chosen (falls back to the standard templates) */
  targets?: Array<{ key: string; label: string; blurb?: string; requirements: Partial<Record<AttributeKey, number>> }>
}

const DEFAULT_RESILIENCE: ResilienceInputs = {
  trainingDaysTrailing12wk: 0,
  plannedPerWeek: 3,
  hasSixMonthHistory: false,
  symmetryRating: null,
  injurySessionsLost: 0,
}

export function computeCard(input: CardInput): Card {
  const now = input.now ?? new Date()
  const age = ageFromBirth(input.profile.birthDate, now)
  const resilience: ResilienceInputs = { ...DEFAULT_RESILIENCE, ...input.resilience }

  const computeInput: ComputeInput = {
    results: input.results,
    profile: input.profile,
    now,
    verifiedCeilings: input.verifiedCeilings,
    resilience,
  }
  const attributes = orderAttributes(computeAttributes(computeInput))

  const buildOvrs = allBuildOvrs(attributes)
  const primaryBuild = (input.profile.primaryBuild as BuildKey) in BUILDS
    ? (input.profile.primaryBuild as BuildKey)
    : "general"
  const ovr = buildOvrs[primaryBuild]
  const archetype = detectArchetype(buildOvrs)

  // Form / current condition.
  const form = computeForm(attributes, input.form ?? FORM_NEUTRAL)
  const currentOvr = ovrFromRatingMap(form.currentByAttr, BUILDS[primaryBuild])

  // Badges.
  const raw = latestRaw(input.results)
  const behavioral: BehavioralPanel = {
    consistencyPct: input.behavioral?.consistencyPct ?? 0,
    streakWeeks: input.behavioral?.streakWeeks ?? 0,
    loadTolerance: input.behavioral?.loadTolerance ?? "unknown",
    testDayDelta: input.behavioral?.testDayDelta ?? null,
    testDayDeltaStreak: input.behavioral?.testDayDeltaStreak ?? 0,
    availabilityWeeks: input.behavioral?.availabilityWeeks ?? 0,
  }
  const badges = computeBadges({
    attrs: attributes,
    raw,
    availabilityFrac: behavioral.consistencyPct / 100,
    availabilityWeeks: behavioral.availabilityWeeks,
    testDayDeltaStreak: behavioral.testDayDeltaStreak,
  })

  // Targets.
  const templates = input.targets ?? TARGET_TEMPLATES
  const targets: CardTarget[] = templates.map((t) => {
    const deltas = targetDeltas(attributes, t.requirements)
    const totalGap = deltas.reduce((a, d) => a + d.gap, 0)
    return { key: t.key, label: t.label, blurb: (t as { blurb?: string }).blurb, deltas, totalGap, done: totalGap === 0 }
  })

  return {
    age,
    attributes,
    ovr,
    currentOvr,
    primaryBuild,
    buildOvrs,
    archetype,
    badges,
    form,
    behavioral,
    targets,
    hasAnyData: input.results.length > 0,
  }
}

function orderAttributes(attrs: AttributeRating[]): AttributeRating[] {
  const byKey = new Map(attrs.map((a) => [a.key, a]))
  return ATTRIBUTE_ORDER.map((k) => byKey.get(k)!).filter(Boolean)
}

function latestRaw(results: TestResultInput[]): Record<string, number | undefined> {
  const out: Record<string, { value: number; at: number }> = {}
  for (const r of results) {
    const at = r.measuredAt?.getTime() ?? 0
    if (!out[r.testKey] || at > out[r.testKey].at) out[r.testKey] = { value: r.value, at }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.value]))
}

export { ATTRIBUTE_ORDER, ATTRIBUTE_TAGLINE, rankFor, roundRating }
export * from "./types"
export { BUILDS, TARGET_TEMPLATES, targetDeltas } from "./ovr"
export type { BuildKey, TargetDelta } from "./ovr"
export { TEST_CATALOG, CATALOG_BY_ATTRIBUTE, getTest } from "./catalog"
export { rateTest, normalizedValue } from "./rate"
export { ageFromBirth } from "./aggregate"
export { ATTRIBUTE_LABELS, ATTRIBUTE_TAGLINE as TAGLINES, SUB_LABELS } from "./attributes"
export { rateSet, EXERCISE_CATALOG, getExercise, epley } from "./training"
export type { SetInput, SetRating, SetContext } from "./training"
export { TIER_LABEL } from "./badges"
export type { BadgeState, BadgeTier } from "./badges"
export { FORM_NEUTRAL } from "./form"
export type { FormInputs, FormResult } from "./form"
export type { ResilienceInputs } from "./aggregate"
