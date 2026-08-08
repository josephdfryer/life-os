import assert from "node:assert/strict"
import test from "node:test"
import { isAllowedLifeModelPath } from "../app/api/life-model/[...path]/route"

test("the Home life-model proxy exposes only explicit canonical commands", () => {
  assert.equal(isAllowedLifeModelPath("regenerate"), true)
  assert.equal(isAllowedLifeModelPath("claims/claim-1/feedback"), true)
  assert.equal(isAllowedLifeModelPath("claims/claim-1"), false)
  assert.equal(isAllowedLifeModelPath("claims/claim-1/feedback/delete"), false)
  assert.equal(isAllowedLifeModelPath("../../people/delete"), false)
  assert.equal(isAllowedLifeModelPath("history"), false)
})
