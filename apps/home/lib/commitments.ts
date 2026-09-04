import { dayKey, HOME_TIME_ZONE, reviewDayBounds, shiftDay, type ActionItem } from "./daily"

// After this many snoozes a commitment stops being snoozable. Home offers only
// "put it on the calendar" or "drop it" — the point of the whole design is that
// deferral cannot be free forever.
export const STALE_DEFER_COUNT = 3

// How many unclaimed action items Home shows at once. The count of the rest is
// visible, but the list is not: a bounded batch gets triaged, a full backlog
// gets scrolled past.
export const UNCLAIMED_BATCH_SIZE = 5
export const ACTION_INBOX_BATCH_SIZE = 5

// Focus is a pull queue, not a due-today list: at most this many Plans may be
// focused at once, chosen by hand or pulled from a suggestion — never by date.
export const MAX_FOCUS = 5

export type CommitmentAction = "done" | "snooze" | "drop" | "schedule" | "focus" | "unfocus"

export type Commitment = {
  id: string
  text: string
  status: string
  dueOn: string | null
  deferCount: number
  createdAt: string
  personId: string | null
  personName: string | null
  /** Days since the commitment was made — the "who is waiting, and how long" signal. */
  ageDays: number
  stale: boolean
  /** Set when pulled into the Focus queue; null everywhere else. */
  focusedAt: string | null
}

export type UnclaimedItem = {
  /** `${interactionId}:${index}` — the action item's address inside the JSON blob. */
  id: string
  interactionId: string
  index: number
  text: string
  personId: string | null
  personName: string | null
  eventName: string | null
  timestamp: string
  ageDays: number
}

export function isStale(deferCount: number) {
  return deferCount >= STALE_DEFER_COUNT
}

/** Whole days between two instants, floored — used for "12 days" wait labels. */
export function daysBetween(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000))
}

/** Snooze ladder: the more a thing has been pushed, the further it goes away. */
export function snoozeTarget(deferCount: number, now = new Date(), timeZone = HOME_TIME_ZONE) {
  const days = deferCount === 0 ? 1 : deferCount === 1 ? 3 : 7
  return shiftDay(dayKey(now, timeZone), days)
}

/**
 * `dueOn` is a date, not an instant, so it is stored at the start of that day in
 * the user's zone. Reading it back with `dayKey` in the same zone round-trips
 * exactly, which a naive UTC midnight would not.
 */
export function dayToDate(day: string, timeZone = HOME_TIME_ZONE) {
  return reviewDayBounds(day, timeZone).start
}

/**
 * Sort for today's list: overdue first (longest overdue at the top), then by
 * how long the person has been waiting. The oldest promise is the loudest.
 */
export function compareDue(a: Commitment, b: Commitment) {
  if (a.dueOn && b.dueOn && a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1
  if (a.dueOn && !b.dueOn) return -1
  if (!a.dueOn && b.dueOn) return 1
  return b.ageDays - a.ageDays
}

/**
 * Focus order: oldest pull first. Focus has no date, so there is nothing to
 * sort by except "how long has this been the thing I'm actually doing" — the
 * same longest-waiting-first instinct as `compareDue`, applied to the pull
 * itself rather than a due date.
 */
export function compareFocus(a: Commitment, b: Commitment) {
  if (!a.focusedAt || !b.focusedAt) return 0
  return a.focusedAt < b.focusedAt ? -1 : a.focusedAt > b.focusedAt ? 1 : 0
}

/**
 * One honest, human-readable reason a candidate is suggested to fill an open
 * Focus slot — never a bare score. Longest-waiting person, then
 * longest-captured, matching the "explain the recommendation" rule: Joseph
 * should be able to see why, not just trust a ranking.
 */
export function suggestionReason(candidate: Commitment) {
  if (candidate.personName && candidate.ageDays > 0) {
    return `${candidate.personName} has waited ${candidate.ageDays}d`
  }
  if (candidate.ageDays > 0) return `captured ${candidate.ageDays}d ago`
  return "captured today"
}

/**
 * Rank open candidates (Action Inbox drafts and parked active Plans) for the
 * single next Focus suggestion. Oldest wait first — a bounded, explainable
 * heuristic, not an opaque score; tune only after real use, per
 * ACTION_SYSTEM_PLAN.md's "add complexity only after usage evidence" rule.
 */
export function rankSuggestions(candidates: Commitment[]) {
  return [...candidates].sort((a, b) => b.ageDays - a.ageDays)
}

/** The hard invariant behind Focus: never more than MAX_FOCUS at once. */
export function canPullIntoFocus(currentFocusedCount: number) {
  return currentFocusedCount < MAX_FOCUS
}

/**
 * Rewrites one entry in an Interaction's `actionItems` JSON, preserving every
 * other entry verbatim. Returns null when the index does not exist so callers
 * can 404 rather than silently corrupting the blob.
 */
export function markActionItem(
  items: ActionItem[],
  index: number,
  completed: boolean,
): string | null {
  if (index < 0 || index >= items.length) return null
  const next = items.map((item, itemIndex) => (
    itemIndex === index ? { ...item, completed } : item
  ))
  return JSON.stringify(next)
}
