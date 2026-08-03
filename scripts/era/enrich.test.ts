import assert from "node:assert/strict"
import { test } from "node:test"
import { attachContext, detachContext } from "@life-os/db/enrich"

// The whole "context can be added later, forever, safely" claim rests on two
// rules. These tests pin them against a fake client so they can run without a
// database and without network.
//
//   1. attachContext is idempotent — a reconciler may run on any schedule.
//   2. band "manual" is immutable to automation — re-running never undoes a
//      human correction.

type Row = {
  id: string
  interactionId: string
  entityType: string
  entityId: string
  role: string
  band: string | null
  source: string | null
  confidence: number | null
  evidence: string | null
  workspaceId: string
}

function fakeDb(seed: Row[] = []) {
  const rows = [...seed]
  let nextId = seed.length + 1
  const keyOf = (r: { interactionId: string; entityType: string; entityId: string; role: string }) =>
    `${r.interactionId}|${r.entityType}|${r.entityId}|${r.role}`

  const client = {
    interactionParticipant: {
      async findUnique({ where }: never) {
        const k = (where as Record<string, Record<string, string>>).interactionId_entityType_entityId_role
        return rows.find(r => keyOf(r) === keyOf(k as never)) ?? null
      },
      async create({ data }: never) {
        const row = { id: `p${nextId++}`, ...(data as object) } as Row
        rows.push(row)
        return row
      },
      async update({ where, data }: never) {
        const row = rows.find(r => r.id === (where as { id: string }).id)!
        Object.assign(row, data)
        return row
      },
      async delete({ where }: never) {
        const i = rows.findIndex(r => r.id === (where as { id: string }).id)
        rows.splice(i, 1)
      },
    },
  }
  // The fake only implements what these two functions touch.
  return { db: client as never, rows }
}

const base = {
  interactionId: "i1",
  workspaceId: "default-workspace",
  entityType: "Place" as const,
  entityId: "place-1",
  role: "location",
  source: "timeline-join",
}

test("attachContext creates once, then reports unchanged", async () => {
  const { db, rows } = fakeDb()

  const first = await attachContext(db, { ...base, band: "auto", confidence: 0.9 })
  assert.equal(first.status, "created")
  assert.equal(rows.length, 1)

  const second = await attachContext(db, { ...base, band: "auto", confidence: 0.9 })
  assert.equal(second.status, "unchanged")
  assert.equal(rows.length, 1, "a re-run must not duplicate the edge")
})

test("attachContext updates when the evidence improves", async () => {
  const { db, rows } = fakeDb()
  await attachContext(db, { ...base, band: "suggested", confidence: 0.4 })

  const result = await attachContext(db, {
    ...base, band: "auto", confidence: 0.95, evidence: { visitId: "v9" },
  })
  assert.equal(result.status, "updated")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].band, "auto")
  assert.equal(rows[0].confidence, 0.95)
  assert.equal(rows[0].evidence, JSON.stringify({ visitId: "v9" }))
})

test("automation cannot overwrite a manual edge", async () => {
  const { db, rows } = fakeDb()
  await attachContext(db, { ...base, band: "manual", source: "manual", confidence: 1 })

  const result = await attachContext(db, {
    ...base, band: "auto", source: "timeline-join", confidence: 0.99,
  })
  assert.equal(result.status, "protected")
  assert.equal(rows[0].band, "manual", "the human decision must survive")
  assert.equal(rows[0].source, "manual")
  assert.equal(rows[0].confidence, 1)
})

test("a human can still overwrite their own manual edge", async () => {
  const { db, rows } = fakeDb()
  await attachContext(db, { ...base, band: "manual", source: "manual", confidence: 1 })

  const result = await attachContext(db, {
    ...base, band: "manual", source: "manual", confidence: 1, evidence: { corrected: true },
  })
  assert.equal(result.status, "updated")
  assert.equal(rows[0].evidence, JSON.stringify({ corrected: true }))
})

test("different roles on the same entity are separate edges", async () => {
  const { db, rows } = fakeDb()
  await attachContext(db, { ...base, entityType: "Person", entityId: "p1", role: "merchant", band: "auto" })
  await attachContext(db, { ...base, entityType: "Person", entityId: "p1", role: "beneficiary", band: "auto" })
  assert.equal(rows.length, 2)
})

test("detachContext refuses to remove a manual edge without force", async () => {
  const { db, rows } = fakeDb()
  await attachContext(db, { ...base, band: "manual", source: "manual" })

  assert.equal(await detachContext(db, base), "protected")
  assert.equal(rows.length, 1)

  assert.equal(await detachContext(db, { ...base, force: true }), "removed")
  assert.equal(rows.length, 0)

  assert.equal(await detachContext(db, base), "missing")
})

test("role is required — a null role would break the upsert key", async () => {
  const { db } = fakeDb()
  await assert.rejects(
    () => attachContext(db, { ...base, role: "" as never, band: "auto" }),
    /role is required/,
  )
})
