import assert from "node:assert/strict"
import { test } from "node:test"
import { findUniqueExactCandidate } from "../server/domain/inbox-person-match"

const qin = {
  id: "qin",
  first: "Qin",
  last: "Fryer",
  emails: "[]",
  phones: "[]",
  closeness: 4,
}

test("uses a unique exact complete name without AI enrichment", () => {
  const result = findUniqueExactCandidate({
    contactName: "  QIN   Fryer ",
  }, [qin])

  assert.equal(result?.person.id, "qin")
  assert.equal(result?.confidence, 95)
})

test("keeps duplicate complete names in manual review", () => {
  const result = findUniqueExactCandidate({
    contactName: "Qin Fryer",
  }, [qin, { ...qin, id: "another-qin" }])

  assert.equal(result, null)
})
