import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { NextRequest } from "next/server"
import { interactionResourceContract } from "@life-os/contracts"
import { db } from "@life-os/db"
import { POST as createInteraction, GET as listInteractions } from "../app/v1/interactions/route"
import { DELETE as deleteInteraction, GET as getInteraction, PATCH as updateInteraction } from "../app/v1/interactions/[id]/route"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceA = `interactions-api-a-${suffix}`
const workspaceB = `interactions-api-b-${suffix}`
const keyA = `lifeos_ia_${suffix}`
const keyB = `lifeos_ib_${suffix}`

test("interactions API: transactional CRUD and workspace isolation", async () => {
  await db.workspace.createMany({ data: [
    { id: workspaceA, name: "Interactions API A", slug: workspaceA },
    { id: workspaceB, name: "Interactions API B", slug: workspaceB },
  ] })
  await Promise.all([createApiKey(workspaceA, keyA), createApiKey(workspaceB, keyB)])
  const [personA, personB, fileA, fileB] = await Promise.all([
    db.person.create({ data: { workspaceId: workspaceA, first: "Ada", last: "A", emails: "[]", phones: "[]", tags: "[]", values: "[]" } }),
    db.person.create({ data: { workspaceId: workspaceB, first: "Grace", last: "B", emails: "[]", phones: "[]", tags: "[]", values: "[]" } }),
    db.importedFile.create({ data: { workspaceId: workspaceA, filename: "a.txt", format: "txt", filePath: "db:a", sizeBytes: 1, content: "a" } }),
    db.importedFile.create({ data: { workspaceId: workspaceB, filename: "b.txt", format: "txt", filePath: "db:b", sizeBytes: 1, content: "b" } }),
  ])

  const createResponse = await createInteraction(request("http://localhost/v1/interactions", keyA, "POST", {
    personId: personA.id,
    sourceFileId: fileA.id,
    type: "meeting",
    timestamp: "2026-08-12T20:00:00.000Z",
    summary: "Planning session",
    actionItems: ["Send notes"],
    amountCents: 1234,
  }))
  assert.equal(createResponse.status, 201)
  const created = interactionResourceContract.parse(await createResponse.json())
  assert.equal(created.personId, personA.id)
  assert.equal(created.amountCents, 1234)
  assert.deepEqual(created.actionItems, ["Send notes"])
  assert.equal(created.file?.retrieveUrl, `/v1/files/${fileA.id}`)
  assert.ok(created.eventId, "manual creation should create a backing Event when none is supplied")

  const [participants, graphEvent, audit] = await Promise.all([
    db.interactionParticipant.findMany({ where: { interactionId: created.id }, orderBy: { entityType: "asc" } }),
    db.graphEvent.findFirst({ where: { workspaceId: workspaceA, subjectId: created.id, eventType: "interaction.created" } }),
    db.auditLog.findFirst({ where: { workspaceId: workspaceA, targetId: created.id, action: "interaction.create" } }),
  ])
  assert.deepEqual(participants.map(row => [row.entityType, row.entityId]), [["Event", created.eventId], ["Person", personA.id]])
  assert.ok(graphEvent)
  assert.ok(audit)

  const listed = await listInteractions(request(`http://localhost/v1/interactions?personId=${personA.id}`, keyA))
  assert.equal(listed.status, 200)
  assert.deepEqual((await listed.json()).data.map((row: { id: string }) => row.id), [created.id])

  const crossRead = await getInteraction(request(`http://localhost/v1/interactions/${created.id}`, keyB), params(created.id))
  assert.equal(crossRead.status, 404)
  const crossPatch = await updateInteraction(request(`http://localhost/v1/interactions/${created.id}`, keyB, "PATCH", { summary: "Hijacked" }), params(created.id))
  assert.equal(crossPatch.status, 404)
  const crossDelete = await deleteInteraction(request(`http://localhost/v1/interactions/${created.id}`, keyB, "DELETE"), params(created.id))
  assert.equal(crossDelete.status, 404)

  const foreignPerson = await createInteraction(request("http://localhost/v1/interactions", keyA, "POST", {
    personId: personB.id, type: "meeting", summary: "Must fail",
  }))
  assert.equal(foreignPerson.status, 404)
  const foreignFile = await createInteraction(request("http://localhost/v1/interactions", keyA, "POST", {
    personId: personA.id, sourceFileId: fileB.id, type: "meeting", summary: "Must fail",
  }))
  assert.equal(foreignFile.status, 404)

  const patchResponse = await updateInteraction(request(`http://localhost/v1/interactions/${created.id}`, keyA, "PATCH", {
    summary: "Planning session complete", amountCents: 2000,
  }), params(created.id))
  assert.equal(patchResponse.status, 200)
  const updated = interactionResourceContract.parse(await patchResponse.json())
  assert.equal(updated.summary, "Planning session complete")
  assert.equal(updated.amountCents, 2000)

  const deleteResponse = await deleteInteraction(request(`http://localhost/v1/interactions/${created.id}`, keyA, "DELETE"), params(created.id))
  assert.equal(deleteResponse.status, 204)
  assert.equal(await db.interaction.count({ where: { id: created.id } }), 0)
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceA } }).catch(() => undefined)
  await db.workspace.delete({ where: { id: workspaceB } }).catch(() => undefined)
  await db.$disconnect()
})

function request(url: string, key: string, method = "GET", body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "x-api-key": key, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function createApiKey(workspaceId: string, rawKey: string) {
  return db.apiKey.create({ data: {
    workspaceId,
    name: `Interactions test ${workspaceId}`,
    keyPrefix: rawKey.slice(0, 20),
    keyHash: createHash("sha256").update(rawKey).digest("hex"),
    scopes: { create: [{ scope: "interactions.read" }, { scope: "interactions.write" }] },
  } })
}
