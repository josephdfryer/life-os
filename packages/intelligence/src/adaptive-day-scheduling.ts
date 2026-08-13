import type { CandidateSlot, FixedBlock } from "./adaptive-day-types"
import { addDays, roundUpToQuarterHour, zonedTimeToUtc } from "./adaptive-day-time"

export const CANDIDATE_START_HOUR = 8
export const CANDIDATE_END_HOUR = 20
export const BUFFER_MINUTES = 15
export const MAX_DAYS_AHEAD = 3

// Finds the earliest open slot of `durationMinutes` within the 8am-8pm
// candidate window, searching `startDay` and up to MAX_DAYS_AHEAD days after
// it, honoring a 15-minute buffer around every fixed block. Returns null
// (never a forced/best-effort slot) if nothing fits — "return nothing rather
// than generic filler" applies here too.
export function findCandidateSlot(
  durationMinutes: number,
  fixedBlocksByDay: Record<string, FixedBlock[]>,
  startDay: string,
  timezone: string,
  now: Date,
): CandidateSlot | null {
  for (let offset = 0; offset <= MAX_DAYS_AHEAD; offset++) {
    const day = addDays(startDay, offset)
    const dayStart = zonedTimeToUtc(day, CANDIDATE_START_HOUR, 0, timezone)
    const dayEnd = zonedTimeToUtc(day, CANDIDATE_END_HOUR, 0, timezone)

    const bufferedBlocks = (fixedBlocksByDay[day] ?? [])
      .map(block => ({
        start: new Date(block.start.getTime() - BUFFER_MINUTES * 60_000),
        end: new Date(block.end.getTime() + BUFFER_MINUTES * 60_000),
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    let cursor = dayStart
    if (offset === 0 && now.getTime() > cursor.getTime()) {
      cursor = roundUpToQuarterHour(now)
    }
    if (cursor.getTime() >= dayEnd.getTime()) continue

    for (const block of bufferedBlocks) {
      const gapMs = block.start.getTime() - cursor.getTime()
      if (gapMs >= durationMinutes * 60_000) {
        return { start: cursor, end: new Date(cursor.getTime() + durationMinutes * 60_000), day }
      }
      if (block.end.getTime() > cursor.getTime()) cursor = block.end
    }

    if (dayEnd.getTime() - cursor.getTime() >= durationMinutes * 60_000) {
      return { start: cursor, end: new Date(cursor.getTime() + durationMinutes * 60_000), day }
    }
  }
  return null
}
