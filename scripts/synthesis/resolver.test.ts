import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizePhone } from "./resolver.ts"

test("normalizePhone: 10-digit US numbers get +1 prefix", () => {
  assert.equal(normalizePhone("4155551234"), "+14155551234")
  assert.equal(normalizePhone("(415) 555-1234"), "+14155551234")
  assert.equal(normalizePhone("415-555-1234"), "+14155551234")
})

test("normalizePhone: already-international numbers keep their country code", () => {
  assert.equal(normalizePhone("+44 20 7946 0018"), "+442079460018")
  assert.equal(normalizePhone("442079460018"), "+442079460018")
})

test("normalizePhone: 00 international prefix is converted to +", () => {
  assert.equal(normalizePhone("00442079460018"), "+442079460018")
})

test("normalizePhone: too-short inputs return null", () => {
  assert.equal(normalizePhone("12345"), null)
  assert.equal(normalizePhone(""), null)
  assert.equal(normalizePhone("abc"), null)
})
