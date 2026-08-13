import assert from "node:assert/strict"
import test from "node:test"
import { toLegacyAuditLogResponse } from "../server/api/audit-log-compat"

test("canonical audit pages retain the legacy Persons response envelope", () => {
  const response = toLegacyAuditLogResponse({
    data: [{
      id: "audit-1",
      createdAt: "2026-08-12T20:00:00.000Z",
      action: "person.create",
      targetType: "person",
      targetId: "person-1",
      actorType: "api_key",
      actorId: "key-1",
      actorLabel: "Importer",
      metadata: { source: "test" },
      user: null,
      apiKey: { id: "key-1", name: "Importer", keyPrefix: "lifeos_test" },
      person: { id: "person-1", first: "Ada", last: "Lovelace" },
    }],
    nextCursor: "opaque-cursor",
    hasMore: true,
    limit: 50,
  }, "workspace-1")

  assert.equal(response.limit, 50)
  assert.equal(response.data.logs.length, 1)
  assert.equal(response.data.logs[0].workspaceId, "workspace-1")
  assert.equal(response.data.logs[0].apiKeyId, "key-1")
  assert.equal(response.data.logs[0].personId, "person-1")
  assert.equal(response.data.logs[0].userId, null)
  assert.deepEqual(response.data.logs[0].metadata, { source: "test" })
  assert.equal("nextCursor" in response, false, "legacy callers must not receive a new top-level shape")
})
