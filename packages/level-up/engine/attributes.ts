import type { AttributeKey } from "./types"

// ─────────────────────────────────────────────
// THE ATTRIBUTE HIERARCHY (spec Part 3)
// 34 measured inputs → sub-ratings → 10 headline ratings → 1 OVR.
// Sub-ratings are residuals or genuinely independent measures — never a
// restatement of the headline, or a fast person gets paid twice in the OVR.
// ─────────────────────────────────────────────

export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  strength: "Strength",
  power: "Power",
  speed: "Speed",
  agility: "Agility",
  engine: "Engine",
  workCapacity: "Work Capacity",
  mobility: "Mobility",
  control: "Control",
  reaction: "Reaction",
  resilience: "Resilience",
}

export const ATTRIBUTE_TAGLINE: Record<AttributeKey, string> = {
  strength: "maximal force",
  power: "explosive output",
  speed: "maximum velocity",
  agility: "change of direction",
  engine: "aerobic capacity",
  workCapacity: "output under fatigue",
  mobility: "usable range",
  control: "balance, landing, coordination",
  reaction: "processing speed",
  resilience: "durability and recovery",
}

export const ATTRIBUTE_ORDER: AttributeKey[] = [
  "strength",
  "power",
  "speed",
  "agility",
  "engine",
  "workCapacity",
  "mobility",
  "control",
  "reaction",
  "resilience",
]

export const SUB_LABELS: Record<string, string> = {
  relativeStrength: "Relative Strength",
  absoluteStrength: "Absolute Strength",
  grip: "Grip",
  verticalPower: "Vertical Power",
  elasticPower: "Elastic Power",
  reactiveStrength: "Reactive Strength Index",
  maxVelocity: "Max Velocity",
  acceleration: "Acceleration",
  speedMaintenance: "Speed Maintenance",
  changeOfDirection: "Change of Direction",
  reactiveAgility: "Reactive Agility",
  deceleration: "Deceleration",
  symmetry: "Symmetry",
  aerobicCapacity: "Aerobic Capacity",
  threshold: "Threshold",
  hrRecovery: "HR Recovery",
  repeatEffort: "Repeat-Effort Capacity",
  ankle: "Ankle",
  hip: "Hip",
  shoulder: "Shoulder",
  staticBalance: "Static Balance",
  dynamicBalance: "Dynamic Balance",
  landingControl: "Landing Control",
  fineMotor: "Fine Motor",
  latency: "Latency",
  consistency: "Consistency",
  availability: "Availability",
  recovery: "Recovery",
}

// OVR weights for the Base Athletic OVR (spec Part 5). Sum = 1.00.
export const OVR_WEIGHTS: Record<AttributeKey, number> = {
  strength: 0.13,
  engine: 0.13,
  power: 0.12,
  speed: 0.11,
  agility: 0.1,
  resilience: 0.1,
  workCapacity: 0.09,
  control: 0.09,
  mobility: 0.08,
  reaction: 0.05,
}

/** Slope of the population curve through the middle — points per SD. Used to
 * translate a rating gap into a residual expressed in SD units. */
export const POINTS_PER_SD = 8.7
