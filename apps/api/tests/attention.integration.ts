import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { NextRequest } from "next/server"
import { attentionQueueContract } from "@life-os/contracts"
import { db } from "@life-os/db"
import { GET as listAttention } from "../app/v1/people/attention/route"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceA = `attention-api-a-${suffix}`
const workspaceB = `attention-api-b-${suffix}`
const keyA = `lifeos_test_att_a_${suffix}`
const keyB = `lifeos_test_att_b_${suffix}`

test("people attention API: overdue people only, most overdue first, workspace-isolated", async () => {
  await db.workspace.createMany({ data: [
    { id: workspaceA, name: "Attention A", slug: workspaceA },
    { id: workspaceB, name: "Attention B", slug: workspaceB },
  ] })
  await Promise.all([createApiKey(workspaceA, keyA, ["people.read"]), createApiKey(workspaceB, keyB, ["people.read"])])

  const day = 86_400_000
  const now = Date.now()
  // Inner circle (cadence 10d), last touch 25 days ago: overdue by 15.
  const overdueClose = await db.person.create({ data: { workspaceId: workspaceA, first: "Ada", last: "Overdue", closeness: 4, source: "manual" } })
  await db.interaction.create({ data: { workspaceId: workspaceA, personId: overdueClose.id, type: "message", timestamp: new Date(now - 25 * day), summary: "last chat" } })
  // Nurture (cadence 90d) with no contact ever: first touch due, score from 9999 days.
  const neverTouched = await db.person.create({ data: { workspaceId: workspaceA, first: "Grace", last: "Never", closeness: 2, source: "manual" } })
  // Inner circle touched yesterday: not overdue.
  const current = await db.person.create({ data: { workspaceId: workspaceA, first: "Linus", last: "Current", closeness: 4, source: "manual" } })
  await db.interaction.create({ data: { workspaceId: workspaceA, personId: current.id, type: "call", timestamp: new Date(now - 1 * day) } })
  // Unreviewed bulk import with no history and no plan: curated out, not scored.
  await db.person.create({ data: { workspaceId: workspaceA, first: "Bulk", last: "Import", closeness: 3, source: "ios_contacts" } })
  // Acquaintance with no plan: never overdue.
  await db.person.create({ data: { workspaceId: workspaceA, first: "Acq", last: "NoPlan", closeness: 1, source: "manual" } })
  // Another workspace's very overdue person must never leak.
  await db.person.create({ data: { workspaceId: workspaceB, first: "Byron", last: "Elsewhere", closeness: 4, source: "manual" } })

  const response = await listAttention(request("http://localhost/v1/people/attention?limit=10", keyA))
  assert.equal(response.status, 200)
  const queue = attentionQueueContract.parse(await response.json())
  assert.equal(queue.limit, 10)
  const ids = queue.data.map(item => item.personId)
  assert.ok(ids.includes(overdueClose.id), "an overdue inner-circle person must be listed")
  assert.ok(ids.includes(neverTouched.id), "a never-contacted nurture person must be listed")
  assert.ok(!ids.includes(current.id), "someone touched yesterday is not overdue")
  assert.ok(queue.data.every(item => item.first !== "Bulk"), "unreviewed bulk imports are curated out")
  assert.ok(queue.data.every(item => item.first !== "Acq"), "acquaintances without a plan are never overdue")
  assert.ok(queue.data.every(item => item.first !== "Byron"), "must not cross workspaces")

  const ada = queue.data.find(item => item.personId === overdueClose.id)!
  assert.equal(ada.cadenceDays, 10)
  assert.equal(ada.daysSinceLast, 25)
  assert.equal(ada.daysOverdue, 15)
  assert.equal(ada.suggestedAction, "reach_out")
  assert.equal(ada.lastInteractionSummary, "last chat")
  const grace = queue.data.find(item => item.personId === neverTouched.id)!
  assert.equal(grace.suggestedAction, "first_touch")
  assert.equal(grace.lastInteractionAt, null)
  assert.ok(grace.score > ada.score, "no contact ever outranks a lapsed cadence")
  assert.equal(queue.data[0].personId, neverTouched.id, "most overdue first")

  const capped = attentionQueueContract.parse(await (await listAttention(request("http://localhost/v1/people/attention?limit=1", keyA))).json())
  assert.equal(capped.data.length, 1)

  const other = attentionQueueContract.parse(await (await listAttention(request("http://localhost/v1/people/attention", keyB))).json())
  assert.deepEqual(other.data.map(item => item.first), ["Byron"])

  const bad = await listAttention(request("http://localhost/v1/people/attention?limit=abc", keyA))
  assert.equal(bad.status, 400)
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceA } }).catch(() => undefined)
  await db.workspace.delete({ where: { id: workspaceB } }).catch(() => undefined)
  await db.$disconnect()
})

async function createApiKey(workspaceId: string, rawKey: string, scopes: string[]) {
  return db.apiKey.create({ data: {
    workspaceId,
    name: `Attention test ${workspaceId}`,
    keyPrefix: rawKey.slice(0, 20),
    keyHash: createHash("sha256").update(rawKey).digest("hex"),
    scopes: { create: scopes.map(scope => ({ scope })) },
  } })
}

function request(url: string, key: string) {
  return new NextRequest(url, { headers: { "x-api-key": key } })
}
