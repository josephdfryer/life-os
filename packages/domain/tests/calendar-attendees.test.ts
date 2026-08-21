import assert from "node:assert/strict"
import test from "node:test"
import {
  attendeeDeclined,
  calendarAttendeesFromSignals,
  declinedAttendeeEmails,
  participatingAttendeeEmails,
  personDeclinedInvite,
} from "../calendar-attendees"

test("declined is the only RSVP that counts as not involved", () => {
  assert.equal(attendeeDeclined("declined"), true)
  assert.equal(attendeeDeclined("Declined"), true)
  assert.equal(attendeeDeclined("accepted"), false)
  assert.equal(attendeeDeclined("tentative"), false)
  assert.equal(attendeeDeclined("needsAction"), false)
  assert.equal(attendeeDeclined(null), false)
})

test("participating attendee emails skip people who declined", () => {
  const emails = participatingAttendeeEmails({
    attendees: [
      { email: "alex@example.com", responseStatus: "declined" },
      { email: "tyler@example.com", responseStatus: "accepted" },
      { email: "pending@example.com", responseStatus: "needsAction" },
    ],
    organizer: { email: "joseph@example.com" },
    creator: { email: "ALEX@example.com" },
  })
  assert.deepEqual(emails, ["tyler@example.com", "pending@example.com", "joseph@example.com"])
})

test("calendar metadata preserves declined RSVP for later Granola matching", () => {
  const attendees = calendarAttendeesFromSignals(JSON.stringify({
    attendees: [
      { email: "alex@example.com", responseStatus: "declined", self: false },
      { email: "tyler@example.com", responseStatus: "accepted" },
    ],
  }))
  assert.deepEqual([...declinedAttendeeEmails(attendees)], ["alex@example.com"])
  assert.equal(personDeclinedInvite(JSON.stringify(["Alex@example.com"]), declinedAttendeeEmails(attendees)), true)
  assert.equal(personDeclinedInvite(JSON.stringify(["tyler@example.com"]), declinedAttendeeEmails(attendees)), false)
})
