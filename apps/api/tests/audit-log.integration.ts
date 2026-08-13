import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { NextRequest } from "next/server"
import { auditLogPageContract } from "@life-os/contracts"
import { db } from "@life-os/db"
import { GET as listAuditLog } from "../app/v1/audit-log/route"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceA = `audit-api-a-${suffix}`
const workspaceB = `audit-api-b-${suffix}`
const keyA = `lifeos_audit_a_${suffix}`
const keyB = `lifeos_audit_b_${suffix}`

test("audit log API: contracts, cursor pagination, filters, and workspace isolation", async () => {
  await db.workspace.createMany({ data: [
    { id: workspaceA, name: "Audit API A", slug: workspaceA },
    { id: workspaceB, name: "Audit API B", slug: workspaceB },
  ] })
  const [apiKeyA, apiKeyB] = await Promise.all([
    createApiKey(workspaceA, keyA),
    createApiKey(workspaceB, keyB),
  ])
  const sharedTime = new Date("2026-08-12T20:00:00.000Z")
  const [firstA, secondA, onlyB] = await Promise.all([
    db.auditLog.create({ data: {
      workspaceId: workspaceA, action: "person.create", targetType: "person", targetId: "person-a",
      actorType: "api_key", actorId: apiKeyA.id, apiKeyId: apiKeyA.id, actorLabel: "Audit A",
      metadata: JSON.stringify({ source: "test-a" }), createdAt: sharedTime,
    } }),
    db.auditLog.create({ data: {
      workspaceId: workspaceA, action: "plan.update", targetType: "plan", targetId: "plan-a",
      actorType: "system", actorLabel: "test-system", metadata: "legacy text", createdAt: sharedTime,
    } }),
    db.auditLog.create({ data: {
      workspaceId: workspaceB, action: "person.create", targetType: "person", targetId: "person-b",
      actorType: "api_key", actorId: apiKeyB.id, apiKeyId: apiKeyB.id, actorLabel: "Audit B",
      metadata: JSON.stringify({ source: "test-b" }), createdAt: sharedTime,
    } }),
  ])

  const pageOneResponse = await listAuditLog(request("http://localhost/v1/audit-log?limit=1", keyA))
  assert.equal(pageOneResponse.status, 200)
  const pageOne = auditLogPageContract.parse(await pageOneResponse.json())
  assert.equal(pageOne.data.length, 1)
  assert.equal(pageOne.hasMore, true)
  assert.ok(pageOne.nextCursor)

  const pageTwoResponse = await listAuditLog(request(
    `http://localhost/v1/audit-log?limit=1&cursor=${encodeURIComponent(pageOne.nextCursor!)}`,
    keyA,
  ))
  const pageTwo = auditLogPageContract.parse(await pageTwoResponse.json())
  assert.equal(pageTwo.data.length, 1)
  assert.deepEqual(
    new Set([...pageOne.data, ...pageTwo.data].map(entry => entry.id)),
    new Set([firstA.id, secondA.id]),
    "date ties must page by id without dropping an entry",
  )
  assert.ok([...pageOne.data, ...pageTwo.data].every(entry => entry.id !== onlyB.id))

  const filtered = auditLogPageContract.parse(await (await listAuditLog(request(
    "http://localhost/v1/audit-log?action=person.create&actorType=api_key&targetType=person",
    keyA,
  ))).json())
  assert.deepEqual(filtered.data.map(entry => entry.id), [firstA.id])
  assert.deepEqual(filtered.data[0].metadata, { source: "test-a" })
  assert.equal(filtered.data[0].apiKey?.id, apiKeyA.id)

  const otherWorkspace = auditLogPageContract.parse(await (await listAuditLog(request("http://localhost/v1/audit-log", keyB))).json())
  assert.deepEqual(otherWorkspace.data.map(entry => entry.id), [onlyB.id])

  const invalidCursor = await listAuditLog(request("http://localhost/v1/audit-log?cursor=not-a-cursor", keyA))
  assert.equal(invalidCursor.status, 400)
  assert.equal((await invalidCursor.json()).error.code, "validation")
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceA } }).catch(() => undefined)
  await db.workspace.delete({ where: { id: workspaceB } }).catch(() => undefined)
  await db.$disconnect()
})

function request(url: string, key: string) {
  return new NextRequest(url, { headers: { "x-api-key": key } })
}

async function createApiKey(workspaceId: string, rawKey: string) {
  return db.apiKey.create({ data: {
    workspaceId,
    name: `Audit test ${workspaceId}`,
    keyPrefix: rawKey.slice(0, 20),
    keyHash: createHash("sha256").update(rawKey).digest("hex"),
    scopes: { create: { scope: "audit.read" } },
  } })
}
