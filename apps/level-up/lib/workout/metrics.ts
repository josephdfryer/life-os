// ─────────────────────────────────────────────
// DERIVED WORKOUT NUMBERS
//
// Every number in here is computed from raw sets on read. Nothing is stored —
// same rule the ratings engine obeys, for the same reason: a stored aggregate
// is a number that can silently disagree with the evidence under it.
// ─────────────────────────────────────────────

export type SetRecord = {
  loadKg: number
  reps: number
  durationSec: number | null
  isBodyweight: boolean
  bodyweightKg: number | null
  performedAt: Date
}

/**
 * Epley. Deliberately the same formula the ratings engine uses for its own
 * e1RM, so the trend line on the exercise screen and the rank on the set can
 * never tell two different stories.
 */
export function epleyE1RM(loadKg: number, reps: number) {
  if (reps <= 0 || loadKg <= 0) return 0
  return loadKg * (1 + reps / 30)
}

/**
 * What the set actually loaded. A bodyweight set moves the body; added weight
 * stacks on top. Without this, a set of pull-ups reads as zero volume.
 */
export function effectiveLoadKg(set: Pick<SetRecord, "loadKg" | "isBodyweight" | "bodyweightKg">) {
  if (!set.isBodyweight) return set.loadKg
  return (set.bodyweightKg ?? 0) + set.loadKg
}

export function setVolumeKg(set: SetRecord) {
  if (set.durationSec !== null) return 0
  return effectiveLoadKg(set) * set.reps
}

export function totalVolumeKg(sets: readonly SetRecord[]) {
  return sets.reduce((sum, set) => sum + setVolumeKg(set), 0)
}

export function totalDurationSec(sets: readonly SetRecord[]) {
  return sets.reduce((sum, set) => sum + (set.durationSec ?? 0), 0)
}

/** The heaviest single set, by effective load. Timed sets have no top set. */
export function topSetKg(sets: readonly SetRecord[]) {
  const loaded = sets.filter(set => set.durationSec === null)
  if (loaded.length === 0) return null
  return Math.max(...loaded.map(effectiveLoadKg))
}

export function bestE1RMKg(sets: readonly SetRecord[]) {
  const loaded = sets.filter(set => set.durationSec === null)
  if (loaded.length === 0) return null
  return Math.max(...loaded.map(set => epleyE1RM(effectiveLoadKg(set), set.reps)))
}

export type TrendPoint = { day: string; valueKg: number }

/**
 * One point per day — the best e1RM that day — because the trend answers "is
 * this going up", not "what did every warm-up set weigh". Ascending by day so
 * the sparkline reads left to right.
 */
export function e1rmTrend(sets: readonly SetRecord[], timeZone = "America/Los_Angeles"): TrendPoint[] {
  const byDay = new Map<string, number>()
  for (const set of sets) {
    if (set.durationSec !== null) continue
    const day = dayKey(set.performedAt, timeZone)
    const value = epleyE1RM(effectiveLoadKg(set), set.reps)
    const current = byDay.get(day)
    if (current === undefined || value > current) byDay.set(day, value)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, valueKg]) => ({ day, valueKg }))
}

export function dayKey(date: Date, timeZone = "America/Los_Angeles") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

/**
 * An SVG polyline path for the trend sparkline, normalised into a viewbox.
 * Returns null below two points — a single dot is not a trend and drawing one
 * would imply more than the data supports.
 */
export function sparklinePath(points: readonly TrendPoint[], width: number, height: number) {
  if (points.length < 2) return null
  const values = points.map(point => point.valueKg)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width
      const y = height - ((point.valueKg - min) / span) * height
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}

export function sessionDurationSec(startedAt: Date, endedAt: Date | null) {
  const end = endedAt ?? new Date()
  return Math.max(0, Math.floor((end.getTime() - startedAt.getTime()) / 1000))
}
