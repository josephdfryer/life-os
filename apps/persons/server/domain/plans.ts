import { db } from "@/lib/db"
import { PlanStatus } from "@life-os/db"
import { notFound, optionalString, optionalStringArray, badRequest, requiredString } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import { formatPlan, jsonList } from "./dto"

export type PlanInput = {
  personId?: unknown
  text?: unknown
  timescale?: unknown
  successSignals?: unknown
  parentId?: unknown
  status?: unknown
}

const PLAN_STATUSES = Object.values(PlanStatus)

function validPlanStatus(value: unknown): PlanStatus {
  if (!PLAN_STATUSES.includes(value as PlanStatus)) {
    throw badRequest(`status must be one of: ${PLAN_STATUSES.join(", ")}`, { field: "status" })
  }
  return value as PlanStatus
}

export async function createPlan(input: PlanInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const personId = optionalString(input.personId)
  if (personId) {
    const person = await db.person.findFirst({ where: { id: personId, workspaceId }, select: { id: true } })
    if (!person) throw notFound("Person not found", { id: personId })
  }

  const plan = await db.plan.create({
    data: {
      workspaceId,
      personId,
      text: requiredString(input.text, "text"),
      timescale: optionalString(input.timescale),
      successSignals: Array.isArray(input.successSignals)
        ? jsonList(optionalStringArray(input.successSignals))
        : null,
      status: input.status !== undefined ? validPlanStatus(input.status) : PlanStatus.active,
      parentId: optionalString(input.parentId),
    },
  })

  await auditAction({ actor, action: "plan.create", targetType: "plan", targetId: plan.id })
  return formatPlan(plan)
}

export async function updatePlan(id: string, input: PlanInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const existing = await db.plan.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw notFound("Plan not found", { id })

  const patch: Record<string, unknown> = {}
  if (input.status !== undefined) patch.status = validPlanStatus(input.status)
  if (input.text !== undefined) patch.text = requiredString(input.text, "text")
  if (input.timescale !== undefined) patch.timescale = optionalString(input.timescale)
  if (input.successSignals !== undefined) {
    patch.successSignals = Array.isArray(input.successSignals)
      ? jsonList(optionalStringArray(input.successSignals))
      : null
  }
  if (input.parentId !== undefined) patch.parentId = optionalString(input.parentId)
  if (input.personId !== undefined) patch.personId = optionalString(input.personId)
  if (typeof patch.personId === "string") {
    const person = await db.person.findFirst({ where: { id: patch.personId, workspaceId }, select: { id: true } })
    if (!person) throw notFound("Person not found", { id: patch.personId })
  }

  const plan = await db.plan.update({ where: { id }, data: patch })
  await auditAction({ actor, action: "plan.update", targetType: "plan", targetId: id, metadata: { fields: Object.keys(patch) } })
  return formatPlan(plan)
}

export async function deletePlan(id: string, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const existing = await db.plan.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw notFound("Plan not found", { id })
  await db.plan.delete({ where: { id } })
  await auditAction({ actor, action: "plan.delete", targetType: "plan", targetId: id })
}
