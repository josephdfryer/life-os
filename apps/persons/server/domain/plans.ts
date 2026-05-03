import { db } from "@/lib/db"
import { notFound, optionalString, optionalStringArray, requiredString } from "@/server/api/errors"
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

export async function createPlan(input: PlanInput, actor?: DomainActor) {
  const plan = await db.plan.create({
    data: {
      personId: optionalString(input.personId),
      text: requiredString(input.text, "text"),
      timescale: optionalString(input.timescale),
      successSignals: Array.isArray(input.successSignals)
        ? jsonList(optionalStringArray(input.successSignals))
        : null,
      status: optionalString(input.status) ?? "active",
      parentId: optionalString(input.parentId),
    },
  })

  await auditAction({ actor, action: "plan.create", targetType: "plan", targetId: plan.id })
  return formatPlan(plan)
}

export async function updatePlan(id: string, input: PlanInput, actor?: DomainActor) {
  const existing = await db.plan.findUnique({ where: { id }, select: { id: true } })
  if (!existing) throw notFound("Plan not found", { id })

  const patch: Record<string, unknown> = {}
  if (input.status !== undefined) patch.status = requiredString(input.status, "status")
  if (input.text !== undefined) patch.text = requiredString(input.text, "text")
  if (input.timescale !== undefined) patch.timescale = optionalString(input.timescale)
  if (input.successSignals !== undefined) {
    patch.successSignals = Array.isArray(input.successSignals)
      ? jsonList(optionalStringArray(input.successSignals))
      : null
  }
  if (input.parentId !== undefined) patch.parentId = optionalString(input.parentId)
  if (input.personId !== undefined) patch.personId = optionalString(input.personId)

  const plan = await db.plan.update({ where: { id }, data: patch })
  await auditAction({ actor, action: "plan.update", targetType: "plan", targetId: id, metadata: { fields: Object.keys(patch) } })
  return formatPlan(plan)
}

export async function deletePlan(id: string, actor?: DomainActor) {
  const existing = await db.plan.findUnique({ where: { id }, select: { id: true } })
  if (!existing) throw notFound("Plan not found", { id })
  await db.plan.delete({ where: { id } })
  await auditAction({ actor, action: "plan.delete", targetType: "plan", targetId: id })
}
