import test from "node:test"
import assert from "node:assert/strict"
import {
  bulkDeletePeopleContract,
  chatMessageContract,
  confirmImportContract,
  mergePersonContract,
  decodeStoredJson,
  encodeStoredJson,
  ruleActionsContract,
  ruleConditionsContract,
  storedStringList,
} from "../index"

test("merge contract rejects merging a person into itself", () => {
  assert.equal(mergePersonContract.safeParse({ keepId: "same", deleteId: "same" }).success, false)
})

test("stored JSON codecs validate contacts and rule definitions predictably", () => {
  assert.deepEqual(decodeStoredJson('["a@example.com"]', storedStringList, "Person.emails", []), ["a@example.com"])
  assert.throws(() => decodeStoredJson('{bad', storedStringList, "Person.emails", []), /Person\.emails: malformed JSON/)
  assert.throws(() => decodeStoredJson('[{"field":"x","operator":"unknown"}]', ruleConditionsContract, "Rule.conditions", []), /Rule\.conditions/)
  assert.equal(encodeStoredJson([{ type: "set_field", field: "status", value: "ready" }], ruleActionsContract, "Rule.actions"), '[{"type":"set_field","field":"status","value":"ready"}]')
})

test("bulk delete contract rejects empty and oversized batches", () => {
  assert.equal(bulkDeletePeopleContract.safeParse({ ids: [] }).success, false)
  assert.equal(bulkDeletePeopleContract.safeParse({ ids: Array.from({ length: 501 }, (_, i) => String(i)) }).success, false)
})

test("chat contract trims a valid message and rejects blank input", () => {
  assert.equal(chatMessageContract.parse({ message: "  hello  " }).message, "hello")
  assert.equal(chatMessageContract.safeParse({ message: "   " }).success, false)
})

test("import confirmation requires typed results", () => {
  assert.equal(confirmImportContract.safeParse({ results: [{ name: "Incomplete" }] }).success, false)
})
