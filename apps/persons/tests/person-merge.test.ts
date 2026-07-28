import assert from "node:assert/strict"
import test from "node:test"
import { buildMergeFields, initialMergeChoices } from "../lib/person-merge"
import type { Person } from "../types"

function person(overrides: Partial<Person>): Person {
  return {
    id: "person",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    first: "Ann",
    last: "Fryer",
    nickname: null,
    title: null,
    headline: null,
    emails: [],
    phones: [],
    birthday: null,
    closeness: 1,
    tags: [],
    values: [],
    notes: null,
    company: null,
    location: null,
    linkedin: null,
    twitter: null,
    website: null,
    facebook: null,
    instagram: null,
    color: null,
    colorSoft: null,
    ...overrides,
  }
}

test("manual merge defaults to filled values, closer relationship, and both notes", () => {
  const a = person({ nickname: null, closeness: 1, notes: "A note" })
  const b = person({ id: "other", nickname: "Annie", closeness: 4, notes: "B note" })
  const choices = initialMergeChoices(a, b)

  assert.equal(choices.nickname, "b")
  assert.equal(choices.closeness, "b")
  assert.equal(choices.notes, "both")
})

test("manual merge applies selected scalar values and combines list fields", () => {
  const a = person({
    nickname: "Ann",
    emails: ["ann@example.com"],
    tags: ["family"],
    notes: "A note",
  })
  const b = person({
    id: "other",
    nickname: "Annie",
    emails: ["ann@example.com", "annie@example.com"],
    phones: ["+15550000000"],
    tags: ["friend"],
    notes: "B note",
  })
  const fields = buildMergeFields(a, b, {
    ...initialMergeChoices(a, b),
    nickname: "b",
    notes: "both",
  })

  assert.equal(fields.nickname, "Annie")
  assert.equal(fields.notes, "A note\n\n---\n\nB note")
  assert.deepEqual(fields.emails, ["ann@example.com", "annie@example.com"])
  assert.deepEqual(fields.phones, ["+15550000000"])
  assert.deepEqual(fields.tags, ["family", "friend"])
})
