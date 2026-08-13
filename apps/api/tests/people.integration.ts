import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { NextRequest } from "next/server"
import { peoplePageContract, personResourceContract } from "@life-os/contracts"
import { db } from "@life-os/db"
import { GET as listPeople, POST as createPerson } from "../app/v1/people/route"
import { GET as getPerson, PATCH as updatePerson } from "../app/v1/people/[id]/route"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceA = `people-api-a-${suffix}`
const workspaceB = `people-api-b-${suffix}`
const keyA = `lifeos_test_a_${suffix}`
const keyB = `lifeos_test_b_${suffix}`
let personAId = ""
let personBId = ""

test("people API: contracts, cursor pagination, and workspace isolation", async () => {
  await db.workspace.createMany({ data: [
    { id: workspaceA, name: "People API A", slug: workspaceA },
    { id: workspaceB, name: "People API B", slug: workspaceB },
  ] })
  const [personA, personB] = await Promise.all([
    db.person.create({ data: { workspaceId: workspaceA, first: "Ada", last: "A", emails: JSON.stringify(["ada@example.test"]), tags: JSON.stringify(["friend"]) } }),
    db.person.create({ data: { workspaceId: workspaceB, first: "Byron", last: "B" } }),
  ])
  personAId = personA.id
  personBId = personB.id
  await Promise.all([
    createApiKey(workspaceA, keyA, ["people.read", "people.write"]),
    createApiKey(workspaceB, keyB, ["people.read", "people.write"]),
  ])

  const createdResponse = await createPerson(request("http://localhost/v1/people", keyA, {
    method: "POST",
    body: JSON.stringify({ first: "Grace", last: "Hopper", emails: ["grace@example.test"], tags: ["builder"] }),
  }))
  assert.equal(createdResponse.status, 201)
  const created = personResourceContract.parse(await createdResponse.json())
  assert.equal(created.first, "Grace")
  assert.deepEqual(created.tags, ["builder"])
  assert.equal((await db.person.findUniqueOrThrow({ where: { id: created.id } })).workspaceId, workspaceA)

  const pageOneResponse = await listPeople(request("http://localhost/v1/people?limit=1", keyA))
  assert.equal(pageOneResponse.status, 200)
  const pageOne = peoplePageContract.parse(await pageOneResponse.json())
  assert.equal(pageOne.data.length, 1)
  assert.equal(pageOne.hasMore, true)
  assert.ok(pageOne.nextCursor)

  const pageTwoResponse = await listPeople(request(`http://localhost/v1/people?limit=1&cursor=${encodeURIComponent(pageOne.nextCursor!)}`, keyA))
  const pageTwo = peoplePageContract.parse(await pageTwoResponse.json())
  assert.equal(pageTwo.data.length, 1)
  assert.notEqual(pageTwo.data[0].id, pageOne.data[0].id)
  assert.ok(pageTwo.data.every(person => person.first !== "Byron"), "a cursor page must never cross workspaces")

  const crossWorkspaceRead = await getPerson(request(`http://localhost/v1/people/${personBId}`, keyA), params(personBId))
  assert.equal(crossWorkspaceRead.status, 404)
  assert.equal((await crossWorkspaceRead.json()).error.code, "not_found")

  const crossWorkspaceUpdate = await updatePerson(request(`http://localhost/v1/people/${personBId}`, keyA, {
    method: "PATCH",
    body: JSON.stringify({ headline: "Must not land" }),
  }), params(personBId))
  assert.equal(crossWorkspaceUpdate.status, 404)
  assert.equal((await db.person.findUniqueOrThrow({ where: { id: personBId } })).headline, null)

  const ownRead = await getPerson(request(`http://localhost/v1/people/${personAId}`, keyA), params(personAId))
  assert.equal(ownRead.status, 200)
  const ownPerson = personResourceContract.parse(await ownRead.json())
  assert.equal(ownPerson.first, "Ada")
  assert.deepEqual(ownPerson.emails, ["ada@example.test"])

  const otherWorkspaceList = peoplePageContract.parse(await (await listPeople(request("http://localhost/v1/people", keyB))).json())
  assert.deepEqual(otherWorkspaceList.data.map(person => person.id), [personBId])
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
    name: `People test ${workspaceId}`,
    keyPrefix: rawKey.slice(0, 20),
    keyHash: createHash("sha256").update(rawKey).digest("hex"),
    scopes: { create: scopes.map(scope => ({ scope })) },
  } })
}
