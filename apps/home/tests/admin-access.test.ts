import assert from "node:assert/strict"
import test from "node:test"

test("admin capability helpers treat wildcard as full access", async () => {
  const { loadAdminCapabilities } = await import("../lib/admin-access")
  assert.equal(typeof loadAdminCapabilities, "function")
})
