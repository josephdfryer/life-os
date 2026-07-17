import { randomUUID } from "node:crypto"

export type WorkflowTerminalStatus = "succeeded" | "partial" | "failed"
export type WorkflowLog = (record: Record<string, unknown>) => void

export function startWorkflowRun(input: {
  workflow: string
  workspaceId?: string
  targetId?: string
  context?: Record<string, unknown>
  now?: () => number
  id?: () => string
  log?: WorkflowLog
}) {
  const now = input.now ?? Date.now
  const runId = (input.id ?? randomUUID)()
  const startedAt = now()
  const log = input.log ?? (record => console.log(JSON.stringify(record)))
  const base = { event: "workflow.run", workflow: input.workflow, runId, workspaceId: input.workspaceId, targetId: input.targetId }
  log({ ...base, phase: "started", startedAt: new Date(startedAt).toISOString(), ...input.context })
  return {
    runId,
    finish(status: WorkflowTerminalStatus, counters: Record<string, unknown> = {}, error?: unknown) {
      const finishedAt = now()
      const errorMessage = error instanceof Error ? error.message : error ? String(error) : undefined
      log({ ...base, phase: "finished", status, durationMs: Math.max(0, finishedAt - startedAt), counters, ...(errorMessage ? { error: errorMessage } : {}) })
    },
  }
}

export function syncHealth(lastSyncedAt: Date | string | null | undefined, lastError: string | null | undefined, staleAfterMs = 24 * 60 * 60 * 1000, now = Date.now()) {
  const timestamp = lastSyncedAt ? new Date(lastSyncedAt).getTime() : NaN
  const ageMs = Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null
  return { stale: ageMs === null || ageMs > staleAfterMs, ageMs, failing: Boolean(lastError) }
}
