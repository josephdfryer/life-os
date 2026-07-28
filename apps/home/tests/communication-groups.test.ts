import assert from "node:assert/strict"
import test from "node:test"
import { groupCommunications, type CommunicationRow } from "../lib/communication-groups"

function message(id: string, minutes: number, phone = "+1 (415) 555-0100"): CommunicationRow {
  return {
    id,
    source: "imessage",
    contactName: "Joseph",
    contactEmail: null,
    contactPhone: phone,
    summary: `Message ${id}`,
    body: null,
    timestamp: new Date(Date.UTC(2026, 6, 28, 12, minutes)),
    direction: "inbound",
    priority: 3,
    candidatePersonId: "person-1",
    candidatePerson: { first: "Joseph", last: "Fryer" },
  }
}

test("groups texts from the same normalized phone within one hour", () => {
  const groups = groupCommunications([
    message("one", 0),
    message("two", 45, "4155550100"),
    message("three", 61),
  ])

  assert.equal(groups.length, 2)
  assert.deepEqual(groups.map(group => group.ids), [["three"], ["one", "two"]])
  assert.equal(groups[1].summary, "2 messages · Message two")
})

test("does not group email or different phone numbers", () => {
  const email = { ...message("email", 10), source: "gmail", contactEmail: "j@example.com" }
  const groups = groupCommunications([message("one", 0), message("two", 5, "+1 212 555 0100"), email])

  assert.equal(groups.length, 3)
  assert.ok(groups.every(group => group.messageCount === 1))
})
