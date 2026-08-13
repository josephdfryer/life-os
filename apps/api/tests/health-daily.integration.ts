import assert from "node:assert/strict"
import test from "node:test"
import { db } from "@life-os/db"
import { ensureHealthMetricDefinitions, recordHealthDailyDigestInTransaction, fireHealthDailyRules, HEALTH_METRIC_TAXONOMY } from "@/lib/health-daily"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceId = `health-daily-test-${suffix}`
let userId = ""
let personId = ""

test("health daily digest: shared write path replaces same-day content instead of duplicating", async () => {
  await db.workspace.create({ data: { id: workspaceId, name: "Health daily test", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "Health", last: "Owner" } })
  personId = person.id
  const user = await db.user.create({ data: { email: `${suffix}@example.test`, personId, workspaceMemberships: { create: { workspaceId, role: "owner" } } } })
  userId = user.id

  assert.ok("step_count" in HEALTH_METRIC_TAXONOMY)
  assert.ok("heart_rate_avg" in HEALTH_METRIC_TAXONOMY)

  const marker = "healthkit:test-device:day:2026-08-10"
  const actor = { type: "system" as const, id: "test-device", label: "life-os-companion" }
  const definitions = await ensureHealthMetricDefinitions(workspaceId, ["step_count", "resting_heart_rate"])

  const first = await db.$transaction(tx => recordHealthDailyDigestInTransaction(tx, definitions, {
    workspaceId, personId, day: "2026-08-10",
    samples: [{ key: "step_count", value: 8000 }, { key: "resting_heart_rate", value: 58 }],
    source: "healthkit", marker, contentLabel: "HealthKit daily digest",
    metadataExtra: { source: "healthkit", deviceId: "test-device" },
    actor,
  }))
  assert.equal(first.states.length, 2)
  await fireHealthDailyRules(first.states, actor)
  assert.equal(await db.note.count({ where: { workspaceId, type: "import" } }), 1)

  // A re-sync of the same day (a device sending a fresher aggregate, or the
  // Health Auto Export webhook firing again) replaces the day's digest —
  // same Note, same marker, updated States — never a second Note.
  const second = await db.$transaction(tx => recordHealthDailyDigestInTransaction(tx, definitions, {
    workspaceId, personId, day: "2026-08-10",
    samples: [{ key: "step_count", value: 9500 }, { key: "resting_heart_rate", value: 57 }],
    source: "healthkit", marker, contentLabel: "HealthKit daily digest",
    metadataExtra: { source: "healthkit", deviceId: "test-device" },
    actor,
  }))
  assert.equal(second.noteId, first.noteId)
  assert.equal(await db.note.count({ where: { workspaceId, type: "import" } }), 1)
  const stepState = await db.state.findFirst({ where: { workspaceId, entityId: personId, definitionId: second.states.find(s => s.definition.value === "step_count")!.definition.id } })
  assert.equal(stepState?.severity, 9500)
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
  await db.user.delete({ where: { id: userId } }).catch(() => undefined)
  await db.$disconnect()
})
