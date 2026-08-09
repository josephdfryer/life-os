import { badRequest, notFound } from "@/server/api/errors"
import { formatPlan } from "./dto"
import type { DomainActor } from "./audit"
import { runRulesForTarget } from "./rules"
import {
  createPlan as sharedCreatePlan,
  updatePlan as sharedUpdatePlan,
  deletePlan as sharedDeletePlan,
  PlanError,
  type PlanInput,
} from "@life-os/domain"

export type { PlanInput }

// Write operations moved to @life-os/domain/plans.ts (Track C, phase C4) —
// same shim pattern as persons.ts. Fires the new plan.create/plan.update
// triggers (packages/domain never depends on packages/automation).

function translate<T>(promise: Promise<T>): Promise<T> {
  return promise.catch(error => {
    if (error instanceof PlanError) throw error.code === "not_found" ? notFound(error.message) : badRequest(error.message)
    throw error
  })
}

export async function createPlan(input: PlanInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const plan = await translate(sharedCreatePlan(input, workspaceId, actor))
  await runRulesForTarget({
    trigger: "plan.create",
    targetType: "plan",
    targetId: plan.id,
    payload: { planId: plan.id, text: plan.text, status: plan.status },
    actor,
  })
  return formatPlan(plan)
}

export async function updatePlan(id: string, input: PlanInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const plan = await translate(sharedUpdatePlan(id, input, workspaceId, actor))
  await runRulesForTarget({
    trigger: "plan.update",
    targetType: "plan",
    targetId: id,
    payload: { planId: id, fields: Object.keys(input) },
    actor,
  })
  return formatPlan(plan)
}

export async function deletePlan(id: string, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  await translate(sharedDeletePlan(id, workspaceId, actor))
}
