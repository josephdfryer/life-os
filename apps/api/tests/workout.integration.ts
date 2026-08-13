import assert from "node:assert/strict"
import test from "node:test"
import {
  ensureSeeded,
  today,
  startSession,
  completeSession,
  logSet,
  logBodyMetric,
  neutralReadinessSnapshot,
  WorkoutCommandError,
} from "@life-os/level-up"
import { db } from "@life-os/db"

const suffix = Date.now().toString(36)
const workspaceId = `workout-test-${suffix}`
let userId = ""

test("workout: today bundle, idempotent session/set replay, body metric", async () => {
  await db.workspace.create({ data: { id: workspaceId, name: "Workout test", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "Workout", last: "Owner" } })
  const user = await db.user.create({ data: { email: `${suffix}@example.test`, personId: person.id, workspaceMemberships: { create: { workspaceId, role: "owner" } } } })
  userId = user.id

  // A real workspace always has a profile row by the time it logs body
  // metrics — created during onboarding (apps/level-up/lib/actions.ts).
  await db.levelUpProfile.create({ data: { workspaceId } })
  await ensureSeeded(workspaceId)

  const bundle = await today(workspaceId, { programDayId: null, flares: { knee: false, lumbar: false } })
  assert.ok(bundle, "seeded program must produce a today bundle")
  assert.ok(bundle!.entries.length > 0)
  assert.equal(bundle!.readiness.band, "full")
  assert.equal(bundle!.readiness.reasonCodes?.[0], "synthetic_neutral_v1")

  // Session start is idempotent: same sourceId + same content replays as a
  // duplicate; same sourceId + different content is a conflict.
  const first = await startSession({
    workspaceId, programDayId: bundle!.programDayId, kneeFlare: false, lumbarFlare: false,
    source: "device", sourceId: "sess-1",
    readiness: neutralReadinessSnapshot(bundle!.readiness.localDay),
  })
  assert.equal(first.duplicate, false)
  const replay = await startSession({
    workspaceId, programDayId: bundle!.programDayId, kneeFlare: false, lumbarFlare: false,
    source: "device", sourceId: "sess-1",
  })
  assert.equal(replay.id, first.id)
  assert.equal(replay.duplicate, true)
  await assert.rejects(
    startSession({ workspaceId, programDayId: bundle!.programDayId, kneeFlare: true, lumbarFlare: false, source: "device", sourceId: "sess-1" }),
    (error: unknown) => error instanceof WorkoutCommandError && error.code === "conflict",
  )

  const entry = bundle!.entries[0]
  const loggedFirst = await logSet({
    workspaceId, sessionId: first.id, exerciseId: entry.exercise.id, exerciseKey: entry.exercise.key,
    catalogKey: null, setIndex: 0, reps: 5, loadKg: 60, durationSec: null, isBodyweight: false, bodyweightKg: null,
    source: "device", sourceId: "set-1",
  })
  assert.equal(loggedFirst.duplicate, false)
  const loggedReplay = await logSet({
    workspaceId, sessionId: first.id, exerciseId: entry.exercise.id, exerciseKey: entry.exercise.key,
    catalogKey: null, setIndex: 0, reps: 5, loadKg: 60, durationSec: null, isBodyweight: false, bodyweightKg: null,
    source: "device", sourceId: "set-1",
  })
  assert.equal(loggedReplay.id, loggedFirst.id)
  assert.equal(loggedReplay.duplicate, true)
  await assert.rejects(
    logSet({
      workspaceId, sessionId: first.id, exerciseId: entry.exercise.id, exerciseKey: entry.exercise.key,
      catalogKey: null, setIndex: 0, reps: 8, loadKg: 60, durationSec: null, isBodyweight: false, bodyweightKg: null,
      source: "device", sourceId: "set-1",
    }),
    (error: unknown) => error instanceof WorkoutCommandError && error.code === "conflict",
  )
  assert.equal(await db.levelUpTrainingSet.count({ where: { workspaceId, sessionId: first.id } }), 1)

  await completeSession({ workspaceId, sessionId: first.id, sessionRpe: 7 })
  const completed = await db.levelUpSession.findUniqueOrThrow({ where: { id: first.id } })
  assert.ok(completed.endedAt)
  assert.equal(completed.sessionRpe, 7)

  const snapshot = await db.levelUpReadinessSnapshot.findUnique({ where: { sessionId: first.id } })
  assert.ok(snapshot, "session start persists the frozen readiness snapshot")
  assert.equal(snapshot!.band, "full")

  await logBodyMetric({ workspaceId, weightKg: 82, bodyFatPct: null, musclePct: null })
  assert.equal(await db.levelUpBodyMetric.count({ where: { workspaceId } }), 1)
  const profile = await db.levelUpProfile.findUnique({ where: { workspaceId } })
  assert.equal(profile?.bodyweightKg, 82)
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
  await db.user.delete({ where: { id: userId } }).catch(() => undefined)
  await db.$disconnect()
})
