import type { CeilingAnchors, Direction } from "./curve"

export type Sex = "male" | "female"
export type ReferencePopulation = "human" | "trained" | "age"
export type TestSource = "combine" | "training" | "self_report" | "wearable"
export type PopulationTag = "general" | "trained"

export type AttributeKey =
  | "strength"
  | "power"
  | "speed"
  | "agility"
  | "engine"
  | "workCapacity"
  | "mobility"
  | "control"
  | "reaction"
  | "resilience"

export type NormParams = { mean: number; sd: number; modeled: boolean }

export type NormContext = { age: number; sex: Sex; population: ReferencePopulation }

export type TestDefinition = {
  key: string
  label: string
  attribute: AttributeKey
  /** which sub-rating this raw input primarily feeds */
  sub?: string
  unit: string
  direction: Direction
  /** value is normalized to bodyweight before rating (relative strength) */
  relative?: boolean
  /** value is a WMA age-grade percentage, mapped straight to a rating */
  wma?: boolean
  /** default source-population tag for a fresh input */
  populationDefault: PopulationTag
  /** norms per reference population; returns null when that population has no norm */
  norm: (ctx: NormContext) => NormParams | null
  /** ceiling anchors in normalized units (per bodyweight when relative) */
  anchors?: CeilingAnchors
  /** protocol flags that must match stored history, e.g. ["countermovement","arms"] */
  protocol?: string[]
  /** short honest note surfaced in the UI */
  note?: string
  /** min raw value the engine will accept (anticipation/lapse guards, etc.) */
  clampMin?: number
  clampMax?: number
}

export type TestResultInput = {
  id?: string
  testKey: string
  value: number
  bodyweightKg?: number | null
  populationSource?: PopulationTag
  source?: TestSource
  measuredAt?: Date
  protocolFlags?: Record<string, unknown> | null
  deviceFingerprint?: string | null
}

export type ConfidenceLevel = {
  band: number // ± points
  display: "lower" | "mid"
  label: string
}

export type AttributeRating = {
  key: AttributeKey
  label: string
  /** the honest point estimate (midpoint) */
  rating: number
  /** what the card shows (lower bound until confidence narrows) */
  displayRating: number
  lower: number
  upper: number
  rank: { letter: string; band: string }
  confidence: ConfidenceLevel
  /** hard cap from protocol/equipment gates, if the estimate is bumping it */
  cap: number | null
  capReason: string | null
  /** combine-verified ceiling (the last completed combine's rating for this attr) */
  verifiedCeiling: number | null
  /** provisional lift from training evidence, in points, capped by band */
  provisional: number
  testCount: number
  subRatings: SubRating[]
  /** the raw measurement(s) one tap deeper */
  evidence: EvidenceItem[]
}

export type SubRating = {
  key: string
  label: string
  rating: number | null
  /** for residual sub-ratings, the residual in SD units */
  residualSd?: number | null
  detail?: string
}

export type EvidenceItem = {
  testKey: string
  label: string
  value: number
  unit: string
  rating: number
  measuredAt: Date
  source: TestSource
  population: PopulationTag
  note?: string
}

export type Profile = {
  birthDate: Date | null
  sex: Sex
  bodyweightKg: number | null
  heightCm: number | null
  standingReachCm: number | null
  primaryBuild: string | null
  coldStartCompletedAt: Date | null
}
