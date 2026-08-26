import assert from "node:assert/strict"
import test from "node:test"
import type { ParsedContact } from "../lib/vcard"
import type { Person } from "../types"
import { DUPLICATE_THRESHOLD, computeFillableFields, findMatch, getStatus, guessNameFromEmail, jaroWinkler, sortByStatus, type ReviewContact } from "../app/import/persons/matching"
import { keepOnly, setActionAt, setSelectedAt, skipAt } from "../app/import/persons/review-transitions"

const person = (patch: Partial<Person> = {}) => ({ id: "person-1", first: "Joseph", last: "Fryer", emails: ["joseph@example.com"], phones: ["+1 555 123 4567"], company: "LifeOS", title: null, headline: null, birthday: null, location: null, linkedin: null, twitter: null, website: null, facebook: null, instagram: null, notes: null, ...patch }) as Person
const contact = (patch: Partial<ParsedContact> = {}) => ({ first: "Joseph", last: "Fryer", email: null, phone: null, company: null, title: null, headline: null, birthday: null, location: null, linkedin: null, twitter: null, website: null, facebook: null, instagram: null, notes: null, ...patch }) as ParsedContact

test("exact email is a certain duplicate regardless of casing", () => {
  const match = findMatch(contact({ email: " JOSEPH@EXAMPLE.COM " }), [person()])
  assert.equal(match?.score, 1)
  assert.equal(match?.reason, "Same email address")
})

test("formatted phone numbers match on digits", () => {
  const match = findMatch(contact({ first: "Different", last: "Name", phone: "(555) 123-4567" }), [person()])
  assert.equal(match?.score, 0.97)
  assert.equal(match?.reason, "Same phone number")
})

test("similar names and company produce a duplicate-strength match", () => {
  const match = findMatch(contact({ first: "Josef", last: "Fryer", company: "LifeOS" }), [person()])
  assert.ok(match)
  assert.ok(match.score >= DUPLICATE_THRESHOLD)
})

test("unrelated names stay unmatched", () => {
  assert.equal(findMatch(contact({ first: "Ada", last: "Lovelace" }), [person()]), null)
  assert.ok(jaroWinkler("ada lovelace", "joseph fryer") < 0.7)
})

test("fillable fields add missing values but never overwrite populated values", () => {
  const fields = computeFillableFields(contact({ email: "new@example.com", company: "Replacement", title: "Founder", location: "Los Angeles" }), [person()][0])
  assert.deepEqual(fields, { email: "new@example.com", title: "Founder", location: "Los Angeles" })
})

test("fillable fields append new imported notes without replacing existing notes", () => {
  const fields = computeFillableFields(
    contact({ notes: "Imported spreadsheet details" }),
    person({ notes: "Existing personal context" }),
  )
  assert.equal(fields.notes, "Existing personal context\n\nImported spreadsheet details")
})

test("email local parts provide deterministic review names", () => {
  assert.deepEqual(guessNameFromEmail("jane.doe42@example.com"), { first: "Jane", last: "Doe" })
  assert.equal(guessNameFromEmail("x@example.com"), null)
})

test("review statuses sort duplicates before possible, error, review, and ready", () => {
  const make = (patch: Partial<ReviewContact>): ReviewContact => ({ ...contact(), closeness: 3, tags: "", skip: false, colorIdx: 0, guessedName: false, guessedFrom: null, needsReview: false, matchResult: null, action: "import", selected: false, ...patch })
  const values = [make({ first: "Ready", email: "ready@example.com" }), make({ first: "", email: null }), make({ first: "Guess", guessedName: true, email: "guess@example.com" }), make({ matchResult: { personId: "1", personName: "P", personEmail: null, personCompany: null, score: 0.75, reason: "Similar", fillableFields: {}, fillableCount: 0 } }), make({ matchResult: { personId: "1", personName: "P", personEmail: null, personCompany: null, score: 1, reason: "Same", fillableFields: {}, fillableCount: 0 } })]
  assert.deepEqual(sortByStatus(values).map(getStatus), ["duplicate", "possible", "error", "review", "ready"])
})

test("bulk review transitions are immutable and clear transient selection", () => {
  const make = (first: string): ReviewContact => ({ ...contact({ first }), closeness: 3, tags: "", skip: false, colorIdx: 0, guessedName: false, guessedFrom: null, needsReview: false, matchResult: null, action: "import", selected: false })
  const original = [make("A"), make("B"), make("C")]
  const selected = setSelectedAt(original, [0, 2], true)
  assert.equal(original[0].selected, false)
  assert.deepEqual(selected.map(value => value.selected), [true, false, true])
  assert.deepEqual(setActionAt(selected, [0, 2], "import_new").map(value => [value.action, value.selected]), [["import_new", false], ["import", false], ["import_new", false]])
  assert.deepEqual(skipAt(selected, [1]).map(value => value.skip), [false, true, false])
  assert.deepEqual(keepOnly(selected, [2]).map(value => value.skip), [true, true, false])
})
