import type { CapacityBandInput, CapacityBandResult } from "./adaptive-day-types"

// Deterministic capacity band rules — see docs/ADAPTIVE_DAY_PLAN.md §2.
// Missing data is neutral, never negative: every check below is gated on
// the signal actually being present (`!= null`), so an absent energy/stress
// reading or an unconnected Level Up band can never push the result toward
// recover/adjust on its own.
export function computeCapacityBand(input: CapacityBandInput): CapacityBandResult {
  const lowEnergy = input.energy != null && input.energy <= 2
  const highStress = input.stress != null && input.stress >= 4

  // recover: real Level Up band is Recover, or energy is low AND stress is
  // high together (either alone is only "adjust" territory, below).
  if (input.levelUpBand === "recover") {
    return { band: "recover", reasonCodes: ["level_up_recover"] }
  }
  if (lowEnergy && highStress) {
    return { band: "recover", reasonCodes: ["energy_low", "stress_high"] }
  }

  // adjust: any one of these alone is enough.
  const reasons: string[] = []
  if (input.levelUpBand === "adjust") reasons.push("level_up_adjust")
  if (input.fixedCommitmentMinutes >= 5 * 60) reasons.push("fixed_commitments_5h_plus")
  if (input.fixedBlockCount >= 4 && (input.longestFreeWindowMinutes ?? Infinity) < 90) reasons.push("no_90min_window")
  if (lowEnergy) reasons.push("energy_low")
  if (highStress) reasons.push("stress_high")

  if (reasons.length > 0) {
    return { band: "adjust", reasonCodes: reasons }
  }

  return { band: "full", reasonCodes: ["no_constraints_detected"] }
}
