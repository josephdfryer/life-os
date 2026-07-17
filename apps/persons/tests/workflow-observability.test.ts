import assert from "node:assert/strict"
import test from "node:test"
import { startWorkflowRun, syncHealth } from "../server/observability/workflow"

test("workflow runs emit correlated start and terminal records", () => {
  const records: Record<string, unknown>[] = []
  const times = [1_000, 1_275]
  const run = startWorkflowRun({ workflow: "gmail.sync", workspaceId: "ws", id: () => "run-1", now: () => times.shift()!, log: record => records.push(record) })
  run.finish("partial", { fetched: 10, staged: 2 })
  assert.deepEqual(records.map(record => record.runId), ["run-1", "run-1"])
  assert.equal(records[1].durationMs, 275)
  assert.equal(records[1].status, "partial")
})

test("sync health distinguishes stale and failing connections", () => {
  const now = Date.parse("2026-07-16T12:00:00Z")
  assert.deepEqual(syncHealth("2026-07-16T11:00:00Z", null, 7_200_000, now), { stale: false, ageMs: 3_600_000, failing: false })
  assert.deepEqual(syncHealth(null, "boom", 1, now), { stale: true, ageMs: null, failing: true })
})
