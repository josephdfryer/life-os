/**
 * Confidence arrives on two different scales, so it has to be stated rather
 * than assumed.
 *
 * Most of the platform stores a 0–1 fraction. ImportStagedVisit does not: the
 * Places importer scores visits out of 100 against AUTO_CREATE_THRESHOLD 70 and
 * STAGE_THRESHOLD 30 (apps/places/server/domain/import.ts). Nothing had ever
 * rendered that column as a percentage before this inbox did, so the mismatch
 * was invisible until it printed "7370% confidence".
 *
 * Lives here rather than beside the component because the server-rendered inbox
 * page normalizes at the point it reads each queue, and a 'use client' module
 * cannot be called from a Server Component.
 */
export function unitConfidence(value: number | null | undefined, scale: 'unit' | 'percent'): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const unit = scale === 'percent' ? value / 100 : value
  // A few legacy rows carry the other scale within a column that is otherwise
  // consistent — 11 dismissed gmail StagedInteraction rows sit at 15–95. Treat
  // anything still above 1 as one of those rather than as a 1,500% match.
  return Math.max(0, Math.min(1, unit > 1 ? unit / 100 : unit))
}
