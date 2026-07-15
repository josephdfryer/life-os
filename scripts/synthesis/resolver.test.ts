import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizePhoneDigits, phoneNumbersMatch } from "@life-os/db"

test("normalizePhoneDigits: 10-digit US numbers normalize to bare digits", () => {
  assert.equal(normalizePhoneDigits("4155551234"), "4155551234")
  assert.equal(normalizePhoneDigits("(415) 555-1234"), "4155551234")
  assert.equal(normalizePhoneDigits("415-555-1234"), "4155551234")
})

test("normalizePhoneDigits: a US country-code '1' prefix is stripped either way", () => {
  assert.equal(normalizePhoneDigits("+14155551234"), "4155551234")
  assert.equal(normalizePhoneDigits("14155551234"), "4155551234")
})

test("normalizePhoneDigits: non-US international numbers keep their country code", () => {
  assert.equal(normalizePhoneDigits("+44 20 7946 0018"), "442079460018")
  assert.equal(normalizePhoneDigits("442079460018"), "442079460018")
})

test("normalizePhoneDigits: 00 international prefix is treated like a leading +", () => {
  assert.equal(normalizePhoneDigits("00442079460018"), "442079460018")
})

test("normalizePhoneDigits: too-short inputs return null", () => {
  assert.equal(normalizePhoneDigits("12345"), null)
  assert.equal(normalizePhoneDigits(""), null)
  assert.equal(normalizePhoneDigits("abc"), null)
})

test("phoneNumbersMatch: same number matches regardless of +1/country-code formatting", () => {
  assert.equal(phoneNumbersMatch("7085341552", "+17085341552"), true)
  assert.equal(phoneNumbersMatch("(708) 534-1552", "17085341552"), true)
  assert.equal(phoneNumbersMatch("7085341552", "7085341553"), false)
})
