import test from "node:test"
import assert from "node:assert/strict"
import {
  bulkDeletePeopleContract,
  approvedEmailContract,
  chatMessageContract,
  confirmImportContract,
  mergePersonContract,
  decodeStoredJson,
  encodeStoredJson,
  ruleActionsContract,
  ruleConditionsContract,
  storedStringList,
  cursorPageContract,
  entityCursorPageContract,
  entityRefContract,
  errorEnvelopeContract,
  graphEventContract,
  noteCreateContract,
  noteResourceContract,
  lifeModelClaimFeedbackContract,
  proposedCommandContract,
  reviewItemActionContract,
  reviewItemBulkDismissContract,
  reviewItemContract,
  updateApprovedEmailContract,
  z,
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

test("approved-email contracts accept invite roles and bounded updates", () => {
  assert.equal(approvedEmailContract.safeParse({ email: "neal@example.com", roleId: "viewer-role" }).success, true)
  assert.equal(updateApprovedEmailContract.safeParse({ status: "revoked" }).success, true)
  assert.equal(updateApprovedEmailContract.safeParse({ roleId: "editor-role" }).success, true)
  assert.equal(updateApprovedEmailContract.safeParse({}).success, false)
  assert.equal(updateApprovedEmailContract.safeParse({ status: "disabled" }).success, false)
})

test("chat contract trims a valid message and rejects blank input", () => {
  assert.equal(chatMessageContract.parse({ message: "  hello  " }).message, "hello")
  assert.deepEqual(chatMessageContract.parse({ message: "hello", fileIds: ["file-1"] }).fileIds, ["file-1"])
  assert.equal(chatMessageContract.safeParse({ message: "   " }).success, false)
})

test("life-model feedback requires replacement text only for corrections", () => {
  assert.equal(lifeModelClaimFeedbackContract.safeParse({ action: "dismiss" }).success, true)
  assert.equal(lifeModelClaimFeedbackContract.safeParse({ action: "correct", replacementStatement: "A more accurate claim." }).success, true)
  assert.equal(lifeModelClaimFeedbackContract.safeParse({ action: "correct" }).success, false)
  assert.equal(lifeModelClaimFeedbackContract.safeParse({ action: "dismiss", replacementStatement: "unexpected" }).success, false)
})

test("import confirmation requires typed results", () => {
  assert.equal(confirmImportContract.safeParse({ results: [{ name: "Incomplete" }] }).success, false)
})

test("entity ref requires both a type and a non-empty id", () => {
  assert.equal(entityRefContract.safeParse({ entityType: "Person", entityId: "p1" }).success, true)
  assert.equal(entityRefContract.safeParse({ entityType: "Person", entityId: "" }).success, false)
  assert.equal(entityRefContract.safeParse({ entityType: "Person" }).success, false)
})

test("error envelope rejects an unknown top-level shape", () => {
  assert.equal(errorEnvelopeContract.safeParse({ error: { code: "bad_request", message: "nope" } }).success, true)
  assert.equal(errorEnvelopeContract.safeParse({ message: "nope" }).success, false)
})

test("cursor page contract accepts data + nextCursor and rejects offset-shaped payloads", () => {
  const page = cursorPageContract(z.object({ id: z.string() }).strict())
  assert.equal(page.safeParse({ data: [{ id: "a" }], nextCursor: "xyz", hasMore: true, limit: 25 }).success, true)
  // total is optional by design — most callers never need it, and computing it
  // is usually more expensive than the page itself.
  assert.equal(page.safeParse({ data: [], nextCursor: null, hasMore: false, limit: 25 }).success, true)
  assert.equal(page.safeParse({ data: [], offset: 0, limit: 25 }).success, false)
})

test("entity cursor pages require stable row ids and explicit continuation state", () => {
  assert.equal(entityCursorPageContract.safeParse({
    data: [{ id: "person-1", first: "Ada" }],
    nextCursor: "cursor-1",
    hasMore: true,
    limit: 200,
  }).success, true)
  assert.equal(entityCursorPageContract.safeParse({
    data: [{ first: "Ada" }],
    nextCursor: null,
    hasMore: false,
    limit: 200,
  }).success, false)
})

test("proposed command carries a command name and a typed input bag", () => {
  assert.equal(proposedCommandContract.safeParse({ command: "acceptStagedInteraction", input: { id: "s1" } }).success, true)
  assert.equal(proposedCommandContract.safeParse({ input: { id: "s1" } }).success, false)
})

test("review item action is exactly one of accept, edit_and_accept, or dismiss", () => {
  assert.equal(reviewItemActionContract.safeParse({ action: "accept" }).success, true)
  assert.equal(reviewItemActionContract.safeParse({ action: "edit_and_accept", input: { personId: "p1" } }).success, true)
  assert.equal(reviewItemActionContract.safeParse({ action: "dismiss", reason: "not a match" }).success, true)
  assert.equal(reviewItemActionContract.safeParse({ action: "edit_and_accept" }).success, false, "edit_and_accept requires input")
  assert.equal(reviewItemActionContract.safeParse({ action: "reject" }).success, false, "reject is not a recognized action")
})

test("bulk dismiss is capped and requires at least one id", () => {
  assert.equal(reviewItemBulkDismissContract.safeParse({ ids: [] }).success, false)
  assert.equal(reviewItemBulkDismissContract.safeParse({ ids: ["r1", "r2"] }).success, true)
  assert.equal(reviewItemBulkDismissContract.safeParse({ ids: Array.from({ length: 201 }, (_, i) => String(i)) }).success, false)
})

test("review item contract round-trips a realistic pending row", () => {
  const parsed = reviewItemContract.safeParse({
    id: "rv1", workspaceId: "default-workspace",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    source: "staged_interaction", sourceId: "st1", itemType: "interaction",
    proposedCommand: { command: "acceptStagedInteraction", input: { id: "st1" } },
    targetType: "Person", targetId: "p1",
    confidence: 0.92, evidence: { matchedOn: "email" },
    riskTier: "review", priority: 3, status: "pending",
    resolvedAt: null, resolvedBy: null, resultType: null, resultId: null,
  })
  assert.equal(parsed.success, true)
})

test("note create accepts subject ids and rejects blank content", () => {
  assert.equal(noteCreateContract.safeParse({ content: "Qin seemed tired", aboutPersonId: "p1", type: "observation" }).success, true)
  assert.equal(noteCreateContract.safeParse({ content: "   " }).success, false)
  assert.equal(noteCreateContract.safeParse({ content: "ok", type: "memo" }).success, false)
  assert.equal(noteResourceContract.safeParse({
    id: "n1",
    createdAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    type: "observation",
    content: "Qin seemed tired",
    metadata: { source: "assistant" },
    sourceFileId: null,
    aboutPersonId: "p1",
    aboutPlaceId: null,
    aboutItemId: null,
    aboutEventId: null,
    aboutPlanId: null,
    aboutGroupId: null,
    aboutStateId: null,
  }).success, true)
})

test("graph event requires a subject reference and an actor type", () => {
  const parsed = graphEventContract.safeParse({
    id: "ev1", workspaceId: "default-workspace", schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    subjectType: "Interaction", subjectId: "i1",
    eventType: "interaction.created",
    actorType: "user", actorId: "u1", sourceConnector: null,
    correlationId: null, causationId: null, causationDepth: 0,
    payload: { amount: 2000 }, provenance: null,
  })
  assert.equal(parsed.success, true)
  assert.equal(graphEventContract.safeParse({ subjectType: "Interaction" }).success, false)
})
