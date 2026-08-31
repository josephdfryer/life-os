import assert from "node:assert/strict"
import test from "node:test"
import {
  attendancePhase,
  attendanceTension,
  parseOwnerAttendance,
  parseOwnerAttendanceAction,
  parseOwnerAttendanceDefault,
  resolveOwnerAttendance,
} from "../calendar-attendance"

test("presence is assumed unless a calendar opts out", () => {
  assert.equal(resolveOwnerAttendance({}), "going")
  assert.equal(resolveOwnerAttendance({ calendarDefaults: [] }), "going")
  assert.equal(resolveOwnerAttendance({ calendarDefaults: ["going"] }), "going")
  assert.equal(resolveOwnerAttendance({ calendarDefaults: [null] }), "going")
  assert.equal(resolveOwnerAttendance({ calendarDefaults: ["not_going"] }), "not_going")
})

test("an explicit plan override always wins", () => {
  assert.equal(resolveOwnerAttendance({
    ownerAttendance: "going",
    calendarDefaults: ["not_going"],
  }), "going")
  assert.equal(resolveOwnerAttendance({
    ownerAttendance: "not_going",
    calendarDefaults: ["going"],
  }), "not_going")
})

test("one going calendar is enough when an occurrence is on several calendars", () => {
  assert.equal(resolveOwnerAttendance({
    calendarDefaults: ["not_going", "going"],
  }), "going")
  assert.equal(resolveOwnerAttendance({
    calendarDefaults: ["not_going", "not_going"],
  }), "not_going")
})

test("tension is the gap between declared intent and what actually happened", () => {
  assert.equal(attendanceTension({ declared: "going", reconciliationStatus: "happened" }), "aligned")
  assert.equal(attendanceTension({ declared: "not_going", reconciliationStatus: "skip" }), "aligned")
  assert.equal(attendanceTension({ declared: "going", reconciliationStatus: "skip" }), "missed")
  assert.equal(attendanceTension({ declared: "going", reconciliationStatus: "cancelled" }), "missed")
  assert.equal(attendanceTension({ declared: "not_going", reconciliationStatus: "happened" }), "showed_up")
  assert.equal(attendanceTension({ declared: "going", reconciliationStatus: "pending" }), "pending")
  assert.equal(attendanceTension({ declared: "not_going", reconciliationStatus: null }), "pending")
})

test("parsers reject unknown values and default calendars to going", () => {
  assert.equal(parseOwnerAttendance("maybe"), null)
  assert.equal(parseOwnerAttendanceDefault("maybe"), "going")
  assert.equal(parseOwnerAttendanceAction("did_go"), "did_go")
  assert.equal(parseOwnerAttendanceAction("rsvp"), null)
})

test("attendance phase is past once the start time has arrived", () => {
  const now = new Date("2026-08-31T18:00:00Z")
  assert.equal(attendancePhase(new Date("2026-08-31T17:00:00Z"), now), "past")
  assert.equal(attendancePhase(new Date("2026-08-31T19:00:00Z"), now), "future")
})
