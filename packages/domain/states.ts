import type { Prisma } from "@life-os/db"
import { writeAuditLog, type AuditActor } from "./audit"
import { publishGraphEvent, type GraphEventActor } from "./events"

type Actor = GraphEventActor & AuditActor

export class StateError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "StateError"
  }
}

export type StateDefinitionInput = {
  entityType: string
  type: string
  value: string
  description?: string | null
}

export type RecordStateInput = {
  entityType: string
  entityId: string
  definitionId: string
  severity?: number | null
  source?: string | null
  sourceNoteId?: string | null
  recordedAt?: Date
}

function required(value: string, field: string) {
  const clean = value.trim()
  if (!clean) throw new StateError(`${field} is required`, "validation")
  return clean
}

export async function ensureStateDefinitionInTransaction(
  tx: Prisma.TransactionClient,
  input: StateDefinitionInput,
  workspaceId = "default-workspace",
) {
  const entityType = required(input.entityType, "entityType")
  const type = required(input.type, "type")
  const value = required(input.value, "value")
  return tx.stateDefinition.upsert({
    where: { workspaceId_entityType_type_value: { workspaceId, entityType, type, value } },
    update: input.description === undefined ? {} : { description: input.description?.trim() || null },
    create: {
      workspaceId,
      entityType,
      type,
      value,
      description: input.description?.trim() || null,
    },
  })
}

export async function recordStateInTransaction(
  tx: Prisma.TransactionClient,
  input: RecordStateInput,
  workspaceId = "default-workspace",
  actor?: Actor,
) {
  const entityType = required(input.entityType, "entityType")
  const entityId = required(input.entityId, "entityId")
  const definition = await tx.stateDefinition.findFirst({
    where: { id: input.definitionId, workspaceId, entityType },
  })
  if (!definition) throw new StateError("State definition not found for this workspace and entity type", "not_found")
  if (input.severity != null && !Number.isFinite(input.severity)) {
    throw new StateError("severity must be a finite number", "validation")
  }

  const state = await tx.state.create({
    data: {
      workspaceId,
      entityType,
      entityId,
      definitionId: definition.id,
      severity: input.severity ?? null,
      source: input.source?.trim() || null,
      sourceNoteId: input.sourceNoteId ?? null,
      recordedAt: input.recordedAt ?? new Date(),
    },
  })
  await publishGraphEvent(tx, {
    workspaceId,
    subjectType: "State",
    subjectId: state.id,
    eventType: "state.record",
    actor,
    idempotencyKey: `state-record:${state.id}`,
    payload: {
      stateId: state.id,
      entityType,
      entityId,
      definitionType: definition.type,
      definitionValue: definition.value,
      severity: state.severity,
    },
  })
  return { state, definition }
}

export async function replaceStatesForSourceNoteInTransaction(
  tx: Prisma.TransactionClient,
  sourceNoteId: string,
  inputs: RecordStateInput[],
  workspaceId = "default-workspace",
  actor?: Actor,
) {
  await tx.state.deleteMany({ where: { workspaceId, sourceNoteId } })
  const recorded = []
  for (const input of inputs) {
    recorded.push(await recordStateInTransaction(tx, { ...input, sourceNoteId }, workspaceId, actor))
  }
  return recorded
}

export async function ensureStateDefinition(input: StateDefinitionInput, workspaceId = "default-workspace") {
  const { db } = await import("@life-os/db")
  return db.$transaction(tx => ensureStateDefinitionInTransaction(tx, input, workspaceId))
}

export async function recordState(input: RecordStateInput, workspaceId = "default-workspace", actor?: Actor) {
  const { db } = await import("@life-os/db")
  const result = await db.$transaction(tx => recordStateInTransaction(tx, input, workspaceId, actor))
  await writeAuditLog({
    actor,
    action: "state.record",
    targetType: "state",
    targetId: result.state.id,
    metadata: { entityType: result.state.entityType, entityId: result.state.entityId },
  })
  return result
}
