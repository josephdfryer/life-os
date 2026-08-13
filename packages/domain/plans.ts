import { PlanStatus } from "@life-os/db"
import { publishGraphEvent, type GraphEventActor } from "./events"
import { writeAuditLog, type AuditActor } from "./audit"

// Extracted from apps/persons/server/domain/plans.ts (Track C, phase C4).
// Framework-agnostic on purpose, same split as persons.ts: no trigger
// firing here (packages/domain never depends on packages/automation — the
// app-layer shim does that) and no response formatting (successSignals'
// JSON-array shaping stays the calling app's concern, same reasoning as
// persons.ts not reimplementing formatPerson).

export class PlanError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "PlanError"
  }
}

const PLAN_STATUSES = Object.values(PlanStatus)

function validPlanStatus(value: unknown): PlanStatus {
  if (!PLAN_STATUSES.includes(value as PlanStatus)) {
    throw new PlanError(`status must be one of: ${PLAN_STATUSES.join(", ")}`, "validation")
  }
  return value as PlanStatus
}

export type PlanInput = {
  personId?: unknown
  text?: unknown
  timescale?: unknown
  successSignals?: unknown
  parentId?: unknown
  status?: unknown
}

export async function createPlan(input: PlanInput, workspaceId = "default-workspace", actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const personId = optionalString(input.personId)
  const parentId = optionalString(input.parentId)
  if (personId) {
    const person = await db.person.findFirst({ where: { id: personId, workspaceId }, select: { id: true } })
    if (!person) throw new PlanError("Person not found", "not_found")
  }
  if (parentId) {
    const parent = await db.plan.findFirst({ where: { id: parentId, workspaceId }, select: { id: true } })
    if (!parent) throw new PlanError("Parent plan not found", "not_found")
  }

  const plan = await db.$transaction(async tx => {
    const created = await tx.plan.create({
      data: {
        workspaceId,
        personId,
        text: requiredString(input.text, "text"),
        timescale: optionalString(input.timescale),
        successSignals: Array.isArray(input.successSignals) ? jsonList(optionalStringArray(input.successSignals)) : null,
        status: input.status !== undefined ? validPlanStatus(input.status) : PlanStatus.active,
        parentId,
      },
    })

    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Plan",
      subjectId: created.id,
      eventType: "plan.create",
      actor,
      idempotencyKey: `plan-create:${created.id}`,
      payload: { text: created.text, status: created.status },
    })

    return created
  })

  await writeAuditLog({ actor, action: "plan.create", targetType: "plan", targetId: plan.id })
  return plan
}

export async function updatePlan(id: string, input: PlanInput, workspaceId = "default-workspace", actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.plan.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw new PlanError("Plan not found", "not_found")

  const patch: Record<string, unknown> = {}
  if (input.status !== undefined) patch.status = validPlanStatus(input.status)
  if (input.text !== undefined) patch.text = requiredString(input.text, "text")
  if (input.timescale !== undefined) patch.timescale = optionalString(input.timescale)
  if (input.successSignals !== undefined) {
    patch.successSignals = Array.isArray(input.successSignals) ? jsonList(optionalStringArray(input.successSignals)) : null
  }
  if (input.parentId !== undefined) patch.parentId = optionalString(input.parentId)
  if (input.personId !== undefined) patch.personId = optionalString(input.personId)
  if (typeof patch.personId === "string") {
    const person = await db.person.findFirst({ where: { id: patch.personId, workspaceId }, select: { id: true } })
    if (!person) throw new PlanError("Person not found", "not_found")
  }
  if (typeof patch.parentId === "string") {
    if (patch.parentId === id) throw new PlanError("A plan cannot be its own parent", "validation")
    const parent = await db.plan.findFirst({ where: { id: patch.parentId, workspaceId }, select: { id: true } })
    if (!parent) throw new PlanError("Parent plan not found", "not_found")
  }

  const plan = await db.$transaction(async tx => {
    const updated = await tx.plan.update({ where: { id }, data: patch })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Plan",
      subjectId: id,
      eventType: "plan.update",
      actor,
      idempotencyKey: `plan-update:${id}:${Date.now()}`,
      payload: { fields: Object.keys(patch) },
    })
    return updated
  })

  await writeAuditLog({ actor, action: "plan.update", targetType: "plan", targetId: id, metadata: { fields: Object.keys(patch) } })
  return plan
}

export async function deletePlan(id: string, workspaceId = "default-workspace", actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.plan.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw new PlanError("Plan not found", "not_found")

  await db.$transaction(async tx => {
    await tx.plan.delete({ where: { id } })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Plan",
      subjectId: id,
      eventType: "plan.delete",
      actor,
      idempotencyKey: `plan-delete:${id}`,
      payload: {},
    })
  })

  await writeAuditLog({ actor, action: "plan.delete", targetType: "plan", targetId: id })
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new PlanError(`${field} is required`, "validation")
  return value.trim()
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function jsonList(value: string[]) {
  return JSON.stringify(value)
}
