import assert from "node:assert/strict"
import test from "node:test"
import { parseVCards, type ParsedContact } from "../lib/vcard"
import { parseCsvContacts } from "../lib/csv-contacts"
import { dedupeEmails, normalizeEmailForMatch, normalizePhoneForMatch } from "../lib/contact-values"
import { computeFillableFields, findMatch } from "../app/import/persons/matching"
import type { Person } from "../types"

const person = (patch: Partial<Person> = {}) => ({
  id: "person-1", first: "Joseph", last: "Fryer",
  emails: ["joseph@example.com"], phones: ["+1 555 123 4567"],
  company: "Life OS", title: null, headline: null, birthday: null, location: null,
  linkedin: null, twitter: null, website: null, facebook: null, instagram: null, notes: null,
  ...patch,
}) as Person

const contact = (patch: Partial<ParsedContact> = {}) => ({
  first: "Joseph", last: "Fryer", fullName: "Joseph Fryer",
  email: null, phone: null, emails: [], phones: [],
  company: null, title: null, headline: null, birthday: null, location: null,
  linkedin: null, twitter: null, website: null, facebook: null, instagram: null, notes: null,
  ...patch,
}) as ParsedContact

const vcard = (body: string) => `BEGIN:VCARD\nVERSION:3.0\n${body}\nEND:VCARD`

// ── Normalization ────────────────────────────────────────────────────────────

test("sub-addressed email normalizes to the same mailbox", () => {
  assert.equal(
    normalizeEmailForMatch("joseph+newsletters@example.com"),
    normalizeEmailForMatch("joseph@example.com"),
  )
})

test("gmail ignores dots in the local part but other providers do not", () => {
  assert.equal(normalizeEmailForMatch("jo.seph@gmail.com"), normalizeEmailForMatch("joseph@gmail.com"))
  assert.notEqual(normalizeEmailForMatch("jo.seph@fastmail.com"), normalizeEmailForMatch("joseph@fastmail.com"))
})

test("malformed addresses normalize to null rather than a bogus key", () => {
  for (const value of ["", "   ", "not-an-email", "@example.com", "joseph@", "joseph@localhost"]) {
    assert.equal(normalizeEmailForMatch(value), null, `expected null for ${JSON.stringify(value)}`)
  }
})

test("phone normalization strips country and trunk prefixes", () => {
  assert.equal(normalizePhoneForMatch("+1 (555) 123-4567"), normalizePhoneForMatch("555.123.4567"))
  assert.equal(normalizePhoneForMatch("001 555 123 4567"), normalizePhoneForMatch("5551234567"))
  assert.equal(normalizePhoneForMatch("12345"), null, "too short to be a number")
})

test("dedupe keeps first-seen formatting and drops equivalent duplicates", () => {
  assert.deepEqual(
    dedupeEmails(["Joseph@Example.com", "joseph+tag@example.com", null, "other@example.com"]),
    ["Joseph@Example.com", "other@example.com"],
  )
})

// ── vCard parsing ────────────────────────────────────────────────────────────

test("typed properties do not leak their parameters into the value", () => {
  const [parsed] = parseVCards(vcard("FN:Joseph Fryer\nEMAIL;TYPE=WORK:joseph@example.com"))
  assert.equal(parsed.email, "joseph@example.com", "TYPE=WORK must not survive into the address")
})

test("apple group prefixes resolve to the underlying property", () => {
  const [parsed] = parseVCards(vcard("FN:Joseph Fryer\nitem1.EMAIL;type=INTERNET:joseph@example.com"))
  assert.equal(parsed.email, "joseph@example.com")
})

test("every address and number survives, with preferred and mobile first", () => {
  const [parsed] = parseVCards(vcard([
    "FN:Joseph Fryer",
    "EMAIL;TYPE=WORK:work@example.com",
    "EMAIL;TYPE=HOME;PREF:home@example.com",
    "TEL;TYPE=HOME:+1 555 000 1111",
    "TEL;TYPE=CELL:+1 555 123 4567",
  ].join("\n")))

  assert.equal(parsed.email, "home@example.com", "PREF wins the primary slot")
  assert.deepEqual(parsed.emails, ["home@example.com", "work@example.com"])
  assert.equal(normalizePhoneForMatch(parsed.phone), normalizePhoneForMatch("5551234567"), "CELL wins the primary slot")
  assert.equal(parsed.phones.length, 2, "the home number is kept as a match key")
})

test("quoted-printable decodes only when the line declares that encoding", () => {
  const [encoded] = parseVCards(vcard("FN:Jos=C3=A9\nN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Fryer;Jos=C3=A9"))
  assert.equal(encoded.first, "José", "declared quoted-printable should decode as UTF-8")

  const [plain] = parseVCards(vcard("FN:Joseph Fryer\nURL:https://example.com/?ref=1b"))
  assert.equal(plain.website, "https://example.com/?ref=1b", "an ordinary '=' must not be treated as an escape")
})

// ── CSV parsing ──────────────────────────────────────────────────────────────

test("google csv keeps every numbered address column", () => {
  const csv = [
    "Given Name,Family Name,E-mail 1 - Value,E-mail 2 - Value",
    "Joseph,Fryer,primary@example.com,secondary@example.com",
  ].join("\n")
  const [parsed] = parseCsvContacts(csv)!
  assert.deepEqual(parsed.emails, ["primary@example.com", "secondary@example.com"])
})

test("google csv splits values packed into one cell", () => {
  const csv = [
    "Given Name,Family Name,E-mail 1 - Value",
    "Joseph,Fryer,a@example.com ::: b@example.com",
  ].join("\n")
  const [parsed] = parseCsvContacts(csv)!
  assert.deepEqual(parsed.emails, ["a@example.com", "b@example.com"])
})

// ── Matching ─────────────────────────────────────────────────────────────────

test("a secondary address is enough to identify the same person", () => {
  const match = findMatch(
    contact({ emails: ["unknown@example.com", "joseph@example.com"], email: "unknown@example.com" }),
    [person()],
  )
  assert.equal(match?.score, 1)
  assert.equal(match?.reason, "Same email address")
})

test("a sub-addressed variant still matches the known mailbox", () => {
  const match = findMatch(contact({ emails: ["joseph+life-os@example.com"] }), [person()])
  assert.equal(match?.score, 1)
})

test("contacts carrying only the primary field still match", () => {
  // The import preview crosses a network boundary; a payload without the
  // multi-value arrays must not silently score zero.
  const legacy = { ...contact(), email: "joseph@example.com" } as ParsedContact
  delete (legacy as Partial<ParsedContact>).emails
  assert.equal(findMatch(legacy, [person()])?.score, 1)
})

test("an unknown secondary address is offered as a fillable field", () => {
  const fields = computeFillableFields(
    contact({ emails: ["joseph@example.com", "joseph@work.example.com"] }),
    [person()][0],
  )
  assert.equal(fields.email, "joseph@work.example.com", "the address the person lacks is the one worth adding")
})

test("no fillable email when the person already knows every address", () => {
  const fields = computeFillableFields(contact({ emails: ["JOSEPH@example.com"] }), person())
  assert.equal(fields.email, undefined)
})
