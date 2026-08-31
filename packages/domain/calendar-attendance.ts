export const OWNER_ATTENDANCE = ["going", "not_going"] as const
export type OwnerAttendance = (typeof OWNER_ATTENDANCE)[number]

export const OWNER_ATTENDANCE_ACTIONS = ["going", "not_going", "did_go", "did_not_go"] as const
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
