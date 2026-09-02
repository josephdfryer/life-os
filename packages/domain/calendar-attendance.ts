export const OWNER_ATTENDANCE = ["going", "not_going"] as const
export type OwnerAttendance = (typeof OWNER_ATTENDANCE)[number]

// "not_event" is a classification, not an attendance answer, and it rides this
// same list on purpose. A calendar row can be the wrong KIND of thing — a
// standing 1:1 that is really an ongoing interaction with one person, not an
// occasion anybody attended — and "did you go?" has no true answer for it. It
// used to be answerable only from a separate Event signals panel; keeping it
// beside the attendance verbs means the judgement is made where the item is
// actually seen, in one control cluster and one round trip.
export const OWNER_ATTENDANCE_ACTIONS = ["going", "not_going", "did_go", "did_not_go", "not_event"] as const
export type OwnerAttendanceAction = (typeof OWNER_ATTENDANCE_ACTIONS)[number]

export type AttendanceTension = "aligned" | "missed" | "showed_up" | "pending"

export function parseOwnerAttendance(value: unknown): OwnerAttendance | null {
  return value === "going" || value === "not_going" ? value : null
}

export function parseOwnerAttendanceDefault(value: unknown): OwnerAttendance {
  return parseOwnerAttendance(value) ?? "going"
}

export function parseOwnerAttendanceAction(value: unknown): OwnerAttendanceAction | null {
  return OWNER_ATTENDANCE_ACTIONS.includes(value as OwnerAttendanceAction)
    ? value as OwnerAttendanceAction
    : null
}

/**
 * Presence is assumed unless stated otherwise (manifesto §IV). A calendar can
 * opt out of that assumption — typically a shared family calendar whose events
 * are not "mine" by default. An explicit Plan override always wins. When an
 * occurrence is on multiple calendars, one "going" source is enough to assume
 * I am going.
 */
export function resolveOwnerAttendance(input: {
  ownerAttendance?: string | null
  calendarDefaults?: Array<string | null | undefined>
}): OwnerAttendance {
  const explicit = parseOwnerAttendance(input.ownerAttendance)
  if (explicit) return explicit
  const defaults = (input.calendarDefaults ?? []).map(parseOwnerAttendanceDefault)
  if (defaults.length > 0 && defaults.every((value) => value === "not_going")) {
    return "not_going"
  }
  return "going"
}

/**
 * Declared intent (Plan.ownerAttendance / calendar default) vs behavioral
 * truth (reconciliation → Event). The gap is the tension layer.
 */
export function attendanceTension(input: {
  declared: OwnerAttendance
  reconciliationStatus: string | null
}): AttendanceTension {
  const happened = input.reconciliationStatus === "happened"
  const skipped = input.reconciliationStatus === "skip" || input.reconciliationStatus === "cancelled"
  if (!happened && !skipped) return "pending"
  if (input.declared === "going" && skipped) return "missed"
  if (input.declared === "not_going" && happened) return "showed_up"
  return "aligned"
}

export function attendancePhase(start: Date, now = new Date()) {
  return start.getTime() <= now.getTime() ? "past" : "future"
}
