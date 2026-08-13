import type { AttributeKey, AttributeRating } from "./types"

// ─────────────────────────────────────────────
// ABILITY vs FORM (spec Part 7)
// A permanent attribute and today's condition are different things. Base is
// what you can do; Current Form is what you'd do today, a modifier of up to
// ±10 points from HRV deviation, sleep debt, acute:chronic load, and pain.
// Sensitivity differs by attribute — Engine swings, Strength barely moves.
// ─────────────────────────────────────────────

export type FormInputs = {
  /** HRV deviation from baseline, in SD (positive = fresher than usual) */
  hrvDeviationSd: number
  /** hours of accumulated sleep debt (positive = under-slept) */
  sleepDebtHours: number
  /** acute:chronic workload ratio (1.0 = balanced; >1.3 = spike) */
  acuteChronicRatio: number
  /** logged pain flags in the last week */
  painFlags: number
}

export const FORM_NEUTRAL: FormInputs = {
  hrvDeviationSd: 0,
  sleepDebtHours: 0,
  acuteChronicRatio: 1.0,
  painFlags: 0,
}

// How much each attribute responds to form (0..1 of the ±10 range).
const FORM_SENSITIVITY: Record<AttributeKey, number> = {
  engine: 1.0,
  workCapacity: 1.0,
  reaction: 0.9,
  power: 0.7,
  speed: 0.7,
  agility: 0.7,
  control: 0.6,
  mobility: 0.5,
  resilience: 0.4,
  strength: 0.2,
}

/** The raw ±10 form signal before per-attribute sensitivity is applied. */
export function formSignal(f: FormInputs): number {
  const hrv = clamp(f.hrvDeviationSd, -2, 2) * 3 // ±6 from HRV
  const sleep = -clamp(f.sleepDebtHours, 0, 12) * 0.5 // up to −6 from sleep debt
  const load = -Math.max(0, f.acuteChronicRatio - 1.2) * 15 // spikes above 1.2 bite
  const pain = -f.painFlags * 3
  return clamp(hrv + sleep + load + pain, -10, 10)
}

export function currentForm(base: number, attr: AttributeKey, signal: number): number {
  return Math.round(base + signal * FORM_SENSITIVITY[attr])
}

export type FormResult = {
  signal: number
  reasons: string[]
  currentByAttr: Record<AttributeKey, number>
}

export function computeForm(attrs: AttributeRating[], f: FormInputs): FormResult {
  const signal = formSignal(f)
  const reasons: string[] = []
  if (f.sleepDebtHours >= 2) reasons.push("sleep debt")
  if (f.acuteChronicRatio > 1.2) reasons.push("elevated acute load")
  if (f.hrvDeviationSd <= -1) reasons.push("suppressed HRV")
  if (f.hrvDeviationSd >= 1) reasons.push("fresh — HRV above baseline")
  if (f.painFlags > 0) reasons.push(`${f.painFlags} pain flag${f.painFlags > 1 ? "s" : ""}`)
  const currentByAttr = attrs.reduce((acc, a) => {
    acc[a.key] = currentForm(a.rating, a.key, signal)
    return acc
  }, {} as Record<AttributeKey, number>)
  return { signal: Math.round(signal), reasons, currentByAttr }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}
