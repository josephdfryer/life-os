import test from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_ROLES } from "@life-os/access"
import { TOOLS, toolsForScopes } from "./tools"

function roleScopes(key: string) {
  const role = DEFAULT_ROLES.find(candidate => candidate.key === key)
  assert.ok(role, `missing ${key} role`)
  return [...role.scopes]
}

test("every Assistant tool declares a concrete permission scope", () => {
  assert.equal(TOOLS.length > 0, true)
  for (const tool of TOOLS) {
    assert.match(tool.requiredScope, /^[a-z-]+\.(read|write)$/)
  }
})

test("Viewer can use every read tool and no write tool", () => {
  const tools = toolsForScopes(roleScopes("viewer"))
  assert.equal(tools.some(tool => tool.capability === "read"), true)
  assert.deepEqual(tools.filter(tool => tool.capability !== "read").map(tool => tool.name), [])
})

test("Editor can use the full current Assistant tool set", () => {
  assert.deepEqual(
    toolsForScopes(roleScopes("editor")).map(tool => tool.name).sort(),
    TOOLS.map(tool => tool.name).sort(),
  )
})
