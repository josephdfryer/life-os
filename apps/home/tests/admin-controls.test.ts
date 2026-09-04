import assert from "node:assert/strict"
import test from "node:test"
import { isAllowed, requiredAdminScope } from "../app/api/admin/[...path]/route"

test("admin proxy allows only the documented access mutations", () => {
  assert.equal(isAllowed("POST", "api-keys"), true)
  assert.equal(isAllowed("POST", "roles"), true)
  assert.equal(isAllowed("POST", "approved-emails"), true)
  assert.equal(isAllowed("PATCH", "api-keys/key-1"), true)
  assert.equal(isAllowed("PATCH", "roles/role-1"), true)
  assert.equal(isAllowed("PATCH", "users/user-1/roles"), true)
  assert.equal(isAllowed("PATCH", "approved-emails/email-1"), true)
  assert.equal(isAllowed("POST", "../../persons/delete"), false)
  assert.equal(isAllowed("PATCH", "roles/role-1/delete"), false)
})

test("admin proxy maps every mutation to its browser-session scope", () => {
  assert.equal(requiredAdminScope("POST", "api-keys"), "apiKeys.manage")
  assert.equal(requiredAdminScope("POST", "roles"), "roles.manage")
  assert.equal(requiredAdminScope("PATCH", "users/user-1/roles"), "roles.manage")
  assert.equal(requiredAdminScope("POST", "approved-emails"), "settings.manage")
  assert.equal(requiredAdminScope("PATCH", "workspaces/workspace-1"), "settings.manage")
  assert.equal(requiredAdminScope("PATCH", "unknown"), null)
})
