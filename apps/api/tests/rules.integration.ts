import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { NextRequest } from "next/server"
import { ruleResourceContract, rulesListContract, ruleTestResultContract } from "@life-os/contracts"
import { db } from "@life-os/db"
import { GET as listRules, POST as createRule } from "../app/v1/rules/route"
import { PATCH as updateRule, DELETE as deleteRule } from "../app/v1/rules/[id]/route"
import { POST as testRule } from "../app/v1/rules/[id]/test/route"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceA = `rules-api-a-${suffix}`
const workspaceB = `rules-api-b-${suffix}`
const keyA = `lifeos_test_a_${suffix}`
const keyB = `lifeos_test_b_${suffix}`
let ruleAId = ""

test("rules API: contracts, mutation, test run, and workspace isolation", async () => {
  await db.workspace.createMany({ data: [
    { id: workspaceA, name: "Rules API A", slug: workspaceA },
    { id: workspaceB, name: "Rules API B", slug: workspaceB },
  ] })
  await Promise.all([
    createApiKey(workspaceA, keyA, ["rules.manage"]),
    createApiKey(workspaceB, keyB, ["rules.manage"]),
  ])

  const createdResponse = await createRule(request("http://localhost/v1/rules", keyA, {
    method: "POST",
    body: JSON.stringify({
      name: "Tag new people", trigger: "person.create",
      conditions: [{ field: "first", operator: "exists" }],
      actions: [{ type: "tag.add", field: "tags", value: "new" }],
    }),
  }))
  assert.equal(createdResponse.status, 201)
  const created = ruleResourceContract.parse(await createdResponse.json())
  ruleAId = created.id
  assert.equal(created.name, "Tag new people")
  assert.equal(created.version, 1)
  assert.equal(created.status, "active")
  assert.equal((await db.rule.findUniqueOrThrow({ where: { id: created.id } })).workspaceId, workspaceA)

  const listResponse = await listRules(request("http://localhost/v1/rules", keyA))
  assert.equal(listResponse.status, 200)
  const list = rulesListContract.parse(await listResponse.json())
  assert.deepEqual(list.rules.map(rule => rule.id), [created.id])

  const updatedResponse = await updateRule(request(`http://localhost/v1/rules/${ruleAId}`, keyA, {
    method: "PATCH",
    body: JSON.stringify({ priority: 5 }),
  }), params(ruleAId))
  const updated = ruleResourceContract.parse(await updatedResponse.json())
  assert.equal(updated.priority, 5)
  assert.equal(updated.version, 2, "an edit bumps the version")

  const testResponse = await testRule(request(`http://localhost/v1/rules/${ruleAId}/test`, keyA, {
    method: "POST",
    body: JSON.stringify({ payload: { first: "Ada" } }),
  }), params(ruleAId))
  assert.equal(testResponse.status, 200)
  const testResult = ruleTestResultContract.parse(await testResponse.json())
  assert.equal(testResult.matched, true)
  assert.equal(testResult.run?.ruleId, ruleAId)

  // Cross-workspace: workspace B's key must not read, list, update, test, or
  // delete workspace A's rule.
  const crossList = rulesListContract.parse(await (await listRules(request("http://localhost/v1/rules", keyB))).json())
  assert.equal(crossList.rules.length, 0)

  const crossUpdate = await updateRule(request(`http://localhost/v1/rules/${ruleAId}`, keyB, {
    method: "PATCH",
    body: JSON.stringify({ name: "Must not land" }),
  }), params(ruleAId))
  assert.equal(crossUpdate.status, 404)
  assert.equal((await db.rule.findUniqueOrThrow({ where: { id: ruleAId } })).name, "Tag new people")

  const crossTest = await testRule(request(`http://localhost/v1/rules/${ruleAId}/test`, keyB, {
    method: "POST",
    body: JSON.stringify({ payload: {} }),
  }), params(ruleAId))
  assert.equal(crossTest.status, 404)

  const crossDelete = await deleteRule(request(`http://localhost/v1/rules/${ruleAId}`, keyB, { method: "DELETE" }), params(ruleAId))
  assert.equal(crossDelete.status, 404)
  assert.ok(await db.rule.findUnique({ where: { id: ruleAId } }), "cross-workspace delete must not remove the row")

  const ownDelete = await deleteRule(request(`http://localhost/v1/rules/${ruleAId}`, keyA, { method: "DELETE" }), params(ruleAId))
  assert.equal(ownDelete.status, 204)
  assert.equal(await db.rule.findUnique({ where: { id: ruleAId } }), null)
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceA } }).catch(() => undefined)
  await db.workspace.delete({ where: { id: workspaceB } }).catch(() => undefined)
  await db.$disconnect()
})

function request(url: string, key: string, init?: { method?: string; body?: string }) {
  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers: { "x-api-key": key, "content-type": "application/json" },
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function createApiKey(workspaceId: string, rawKey: string, scopes: string[]) {
  return db.apiKey.create({ data: {
    workspaceId,
    name: `Rules test ${workspaceId}`,
    keyPrefix: rawKey.slice(0, 20),
    keyHash: createHash("sha256").update(rawKey).digest("hex"),
    scopes: { create: scopes.map(scope => ({ scope })) },
  } })
}
