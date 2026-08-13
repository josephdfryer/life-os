import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { NextRequest } from "next/server"
import { plansPageContract, planResourceContract } from "@life-os/contracts"
import { db } from "@life-os/db"
import { GET as listPlans, POST as createPlan } from "../app/v1/plans/route"
import { GET as getPlan, PATCH as updatePlan } from "../app/v1/plans/[id]/route"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceA = `plans-api-a-${suffix}`
const workspaceB = `plans-api-b-${suffix}`
const keyA = `lifeos_plans_a_${suffix}`
const keyB = `lifeos_plans_b_${suffix}`
let personAId = ""
let personBId = ""
let planAId = ""
let planBId = ""

test("plans API: contracts, cursor pagination, and workspace isolation", async () => {
  await db.workspace.createMany({ data: [
    { id: workspaceA, name: "Plans API A", slug: workspaceA },
    { id: workspaceB, name: "Plans API B", slug: workspaceB },
  ] })
  const [personA, personB] = await Promise.all([
    db.person.create({ data: { workspaceId: workspaceA, first: "Plan", last: "Owner A" } }),
    db.person.create({ data: { workspaceId: workspaceB, first: "Plan", last: "Owner B" } }),
  ])
  personAId = personA.id
  personBId = personB.id
  const [planA, planB] = await Promise.all([
    db.plan.create({ data: { workspaceId: workspaceA, personId: personAId, text: "Existing A", successSignals: JSON.stringify(["signal-a"]) } }),
    db.plan.create({ data: { workspaceId: workspaceB, personId: personBId, text: "Existing B" } }),
  ])
  planAId = planA.id
  planBId = planB.id
  await Promise.all([
    createApiKey(workspaceA, keyA, ["plans.read", "plans.write"]),
    createApiKey(workspaceB, keyB, ["plans.read", "plans.write"]),
  ])

  const createdResponse = await createPlan(request("http://localhost/v1/plans", keyA, {
    method: "POST",
    body: JSON.stringify({ personId: personAId, text: "Follow up", successSignals: ["reply received"] }),
  }))
  assert.equal(createdResponse.status, 201)
  const created = planResourceContract.parse(await createdResponse.json())
  assert.equal(created.text, "Follow up")
  assert.deepEqual(created.successSignals, ["reply received"])
  assert.equal((await db.plan.findUniqueOrThrow({ where: { id: created.id } })).workspaceId, workspaceA)

  const crossPersonCreate = await createPlan(request("http://localhost/v1/plans", keyA, {
    method: "POST",
    body: JSON.stringify({ personId: personBId, text: "Must not link" }),
  }))
  assert.equal(crossPersonCreate.status, 404)

  const crossParentCreate = await createPlan(request("http://localhost/v1/plans", keyA, {
    method: "POST",
    body: JSON.stringify({ parentId: planBId, text: "Must not parent" }),
  }))
  assert.equal(crossParentCreate.status, 404)

  const pageOneResponse = await listPlans(request("http://localhost/v1/plans?limit=1", keyA))
  assert.equal(pageOneResponse.status, 200)
  const pageOne = plansPageContract.parse(await pageOneResponse.json())
  assert.equal(pageOne.data.length, 1)
  assert.equal(pageOne.hasMore, true)
  assert.ok(pageOne.nextCursor)

  const pageTwo = plansPageContract.parse(await (await listPlans(request(
    `http://localhost/v1/plans?limit=1&cursor=${encodeURIComponent(pageOne.nextCursor!)}`,
    keyA,
  ))).json())
  assert.equal(pageTwo.data.length, 1)
  assert.notEqual(pageTwo.data[0].id, pageOne.data[0].id)
  assert.ok(pageTwo.data.every(plan => plan.text !== "Existing B"), "a cursor page must never cross workspaces")

  const crossWorkspaceRead = await getPlan(request(`http://localhost/v1/plans/${planBId}`, keyA), params(planBId))
  assert.equal(crossWorkspaceRead.status, 404)
  assert.equal((await crossWorkspaceRead.json()).error.code, "not_found")

  const crossWorkspaceUpdate = await updatePlan(request(`http://localhost/v1/plans/${planBId}`, keyA, {
    method: "PATCH",
    body: JSON.stringify({ status: "completed" }),
  }), params(planBId))
  assert.equal(crossWorkspaceUpdate.status, 404)
  assert.equal((await db.plan.findUniqueOrThrow({ where: { id: planBId } })).status, "active")

  const ownRead = await getPlan(request(`http://localhost/v1/plans/${planAId}`, keyA), params(planAId))
  assert.equal(ownRead.status, 200)
  const ownPlan = planResourceContract.parse(await ownRead.json())
  assert.equal(ownPlan.text, "Existing A")
  assert.deepEqual(ownPlan.successSignals, ["signal-a"])

  const otherWorkspaceList = plansPageContract.parse(await (await listPlans(request("http://localhost/v1/plans", keyB))).json())
  assert.deepEqual(otherWorkspaceList.data.map(plan => plan.id), [planBId])
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
    name: `Plans test ${workspaceId}`,
    keyPrefix: rawKey.slice(0, 20),
    keyHash: createHash("sha256").update(rawKey).digest("hex"),
    scopes: { create: scopes.map(scope => ({ scope })) },
  } })
}
