import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { NextRequest } from "next/server"
import { eventResourceContract, eventsPageContract } from "@life-os/contracts"
import { db } from "@life-os/db"
import { GET as listEvents, POST as createEvent } from "../app/v1/events/route"
import { GET as getEvent, PATCH as updateEvent, DELETE as deleteEvent } from "../app/v1/events/[id]/route"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceA = `events-api-a-${suffix}`
const workspaceB = `events-api-b-${suffix}`
const keyA = `lifeos_test_a_${suffix}`
const keyB = `lifeos_test_b_${suffix}`
let eventBId = ""

test("events API: contracts, cursor pagination, and workspace isolation", async () => {
  await db.workspace.createMany({ data: [
    { id: workspaceA, name: "Events API A", slug: workspaceA },
    { id: workspaceB, name: "Events API B", slug: workspaceB },
  ] })
  const eventB = await db.event.create({ data: { workspaceId: workspaceB, name: "Other workspace's event", type: "meeting", start: new Date(), timestamp: new Date() } })
  eventBId = eventB.id
  await Promise.all([
    createApiKey(workspaceA, keyA, ["life-events.read", "life-events.write"]),
    createApiKey(workspaceB, keyB, ["life-events.read", "life-events.write"]),
  ])

  const createdResponse = await createEvent(request("http://localhost/v1/events", keyA, {
    method: "POST",
    body: JSON.stringify({ name: "Coffee with Ada", type: "meeting", metadata: { location: "cafe" } }),
  }))
  assert.equal(createdResponse.status, 201)
  const created = eventResourceContract.parse(await createdResponse.json())
  assert.equal(created.name, "Coffee with Ada")
  assert.deepEqual(created.metadata, { location: "cafe" })
  assert.equal((await db.event.findUniqueOrThrow({ where: { id: created.id } })).workspaceId, workspaceA)

  const pageOneResponse = await listEvents(request("http://localhost/v1/events?limit=1", keyA))
  assert.equal(pageOneResponse.status, 200)
  const pageOne = eventsPageContract.parse(await pageOneResponse.json())
  assert.equal(pageOne.data.length, 1)
  assert.ok(pageOne.data.every(event => event.id !== eventBId), "a cursor page must never cross workspaces")

  const crossWorkspaceRead = await getEvent(request(`http://localhost/v1/events/${eventBId}`, keyA), params(eventBId))
  assert.equal(crossWorkspaceRead.status, 404)
  assert.equal((await crossWorkspaceRead.json()).error.code, "not_found")

  const crossWorkspaceUpdate = await updateEvent(request(`http://localhost/v1/events/${eventBId}`, keyA, {
    method: "PATCH",
    body: JSON.stringify({ name: "Must not land" }),
  }), params(eventBId))
  assert.equal(crossWorkspaceUpdate.status, 404)
  assert.equal((await db.event.findUniqueOrThrow({ where: { id: eventBId } })).name, "Other workspace's event")

  const crossWorkspaceDelete = await deleteEvent(request(`http://localhost/v1/events/${eventBId}`, keyA, { method: "DELETE" }), params(eventBId))
  assert.equal(crossWorkspaceDelete.status, 404)
  assert.ok(await db.event.findUnique({ where: { id: eventBId } }), "cross-workspace delete must not remove the row")

  const ownRead = await getEvent(request(`http://localhost/v1/events/${created.id}`, keyA), params(created.id))
  assert.equal(ownRead.status, 200)
  assert.equal(eventResourceContract.parse(await ownRead.json()).name, "Coffee with Ada")

  const otherWorkspaceList = eventsPageContract.parse(await (await listEvents(request("http://localhost/v1/events", keyB))).json())
  assert.deepEqual(otherWorkspaceList.data.map(event => event.id), [eventBId])

  const ownDelete = await deleteEvent(request(`http://localhost/v1/events/${created.id}`, keyA, { method: "DELETE" }), params(created.id))
  assert.equal(ownDelete.status, 204)
  assert.equal(await db.event.findUnique({ where: { id: created.id } }), null)
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
    name: `Events test ${workspaceId}`,
    keyPrefix: rawKey.slice(0, 20),
    keyHash: createHash("sha256").update(rawKey).digest("hex"),
    scopes: { create: scopes.map(scope => ({ scope })) },
  } })
}
