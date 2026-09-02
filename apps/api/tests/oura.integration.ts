import assert from "node:assert/strict"
import { createHmac } from "crypto"
import test from "node:test"
import { db } from "@life-os/db"
import { assembleReadinessSnapshot } from "@life-os/level-up"
import { importedOuraDaysFromNotes, ingestOuraDay, isSqliteBusy, normalizeOuraDay, ouraDayMarker } from "@/lib/oura-ingest"
import { signOuraState, verifyOuraState, verifyOuraWebhookSignature, grantedScopeIncludesDaily } from "@/lib/oura"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceId = `oura-test-${suffix}`
let userId = ""
let personId = ""

test("oura: daily documents become source=oura States and replace on reprocess", async () => {
  await db.workspace.create({ data: { id: workspaceId, name: "Oura test", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "Oura", last: "Owner" } })
  personId = person.id
  const user = await db.user.create({ data: { email: `${suffix}@example.test`, personId, workspaceMemberships: { create: { workspaceId, role: "owner" } } } })
  userId = user.id
  await db.workspace.update({ where: { id: workspaceId }, data: { ownerUserId: user.id } })

  const firstDocs = {
    daily_readiness: {
      id: "ready-1",
      day: "2026-08-14",
      score: 82,
      contributors: { activity_balance: 70, hrv_balance: 75, previous_night: null },
    },
    daily_sleep: { id: "sleep-1", day: "2026-08-14", score: 76, contributors: { deep_sleep: 80 } },
    daily_activity: { id: "act-1", day: "2026-08-14", score: 88 },
    daily_stress: { id: "stress-1", day: "2026-08-14", stress_high: 3600, recovery_high: 7200, day_summary: "normal" },
  }

  const normalized = normalizeOuraDay(firstDocs)
  assert.equal(normalized.samples.find(sample => sample.key === "oura_readiness_score")?.value, 82)
  assert.equal(normalized.samples.find(sample => sample.key === "oura_readiness_activity_balance")?.value, 70)
  assert.equal(normalized.samples.some(sample => sample.key === "oura_readiness_previous_night"), false)
  assert.equal(normalized.samples.find(sample => sample.key === "oura_sleep_score")?.value, 76)
  assert.equal(normalized.samples.find(sample => sample.key === "oura_stress_summary")?.value, 2)
  assert.deepEqual(normalized.documentIds, {
    daily_readiness: "ready-1",
    daily_sleep: "sleep-1",
    daily_activity: "act-1",
    daily_stress: "stress-1",
  })

  const first = await ingestOuraDay({ workspaceId, personId, day: "2026-08-14", documents: firstDocs })
  assert.ok(first.noteId)
  assert.equal(await db.note.count({ where: { workspaceId, type: "import" } }), 1)
  const note = await db.note.findUniqueOrThrow({ where: { id: first.noteId } })
  assert.match(note.metadata ?? "", /oura:day:2026-08-14/)
  const readiness = await db.state.findFirst({
    where: { workspaceId, entityId: personId, source: "oura", definition: { value: "oura_readiness_score" } },
  })
  assert.equal(readiness?.severity, 82)
  assert.equal(readiness?.sourceNoteId, first.noteId)

  const second = await ingestOuraDay({
    workspaceId,
    personId,
    day: "2026-08-14",
    documents: { ...firstDocs, daily_readiness: { ...firstDocs.daily_readiness, score: 91 } },
  })
  assert.equal(second.noteId, first.noteId)
  assert.equal(await db.note.count({ where: { workspaceId, type: "import" } }), 1)
  const updated = await db.state.findFirst({
    where: { workspaceId, entityId: personId, source: "oura", definition: { value: "oura_readiness_score" } },
  })
  assert.equal(updated?.severity, 91)
  assert.equal(ouraDayMarker("2026-08-14"), "oura:day:2026-08-14")

  const snapshot = await assembleReadinessSnapshot(workspaceId, "2026-08-14")
  assert.equal(snapshot.band, "full")
  assert.deepEqual(snapshot.reasonCodes, ["oura_shadow_v1"])
  assert.equal((snapshot.inputs.oura as { readinessScore: number }).readinessScore, 91)
  assert.equal((snapshot.inputs.sources as { readiness: string }).readiness, "oura")
  assert.equal(snapshot.inputs.synthetic, false)
})

test("oura: imported day markers are parsed from Note metadata", () => {
  const days = importedOuraDaysFromNotes([
    { metadata: JSON.stringify({ sourceMarker: "oura:day:2026-08-02" }) },
    { metadata: JSON.stringify({ sourceMarker: "healthkit:day:2026-08-02" }) },
    { metadata: "not-json" },
  ])
  assert.deepEqual([...days], ["2026-08-02"])
})

test("oura: sqlite busy errors are retried", () => {
  assert.equal(isSqliteBusy(new Error("prisma:error SQLITE_BUSY: database is locked")), true)
  assert.equal(isSqliteBusy({ code: "P2034", message: "Transaction failed due to a write conflict" }), true)
  assert.equal(isSqliteBusy(new Error("validation")), false)
})

test("oura: oauth state and webhook signatures reject tampering", () => {
  const state = signOuraState({ workspaceId: "ws-1", nonce: "abc", returnTo: "/admin/connections" })
  assert.equal(verifyOuraState(state).workspaceId, "ws-1")
  assert.throws(() => verifyOuraState(state.replace(/.$/, "x")))
  assert.equal(grantedScopeIncludesDaily("daily"), true)
  assert.equal(grantedScopeIncludesDaily("email personal"), false)

  const previous = process.env.OURA_CLIENT_SECRET
  process.env.OURA_CLIENT_SECRET = "oura-test-secret"
  const raw = JSON.stringify({ event_type: "update", data_type: "daily_readiness", object_id: "doc-1" })
  const timestamp = "1710000000"
  const signature = createHmac("sha256", "oura-test-secret").update(timestamp + raw).digest("hex").toUpperCase()
  assert.equal(verifyOuraWebhookSignature(signature, timestamp, raw), true)
  assert.equal(verifyOuraWebhookSignature("DEADBEEF", timestamp, raw), false)
  if (previous === undefined) delete process.env.OURA_CLIENT_SECRET
  else process.env.OURA_CLIENT_SECRET = previous
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
  await db.user.delete({ where: { id: userId } }).catch(() => undefined)
  await db.$disconnect()
})
