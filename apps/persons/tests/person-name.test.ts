import assert from "node:assert/strict"
import test from "node:test"
import { optionalLastName, requiredFirstName } from "../server/domain/person-name"

test("a Person can use one name without a surname placeholder", () => {
  assert.equal(requiredFirstName(" Manav "), "Manav")
  assert.equal(optionalLastName(""), "")
  assert.equal(optionalLastName("   "), "")
  assert.equal(optionalLastName(undefined), "")
})

test("first name remains required", () => {
  assert.throws(() => requiredFirstName(""), /first is required/)
})
