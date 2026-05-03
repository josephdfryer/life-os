import { db } from "@/lib/db"
import { badRequest, notFound, optionalString, requiredString } from "@/server/api/errors"
import { auditAction } from "./audit"
import type { AccessActor } from "./access"

type RuleCondition = {
  field: string
  operator: "equals" | "not_equals" | "contains" | "in" | "exists" | "not_exists"
  value?: unknown
}

type RuleAction = {
  type: string
  field?: string
  value?: unknown
}

export type RuleInput = {
  name?: unknown
  description?: unknown
  trigger?: unknown
  status?: unknown
  priority?: unknown
  mode?: unknown
  conditions?: unknown
  actions?: unknown
  stopProcessing?: unknown
}

export async function listRules() {
  const [rules, runCount] = await Promise.all([
    db.rule.findMany({
      include: { createdByUser: true, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    }),
    db.ruleRun.count(),
  ])
  return { rules: rules.map(formatRule), runCount }
}

export async function createRule(input: RuleInput, actor: AccessActor) {
  const conditions = parseJsonArray(input.conditions, "conditions")
  const actions = parseJsonArray(input.actions, "actions")
  const rule = await db.rule.create({
    data: {
      name: requiredString(input.name, "name"),
      description: optionalString(input.description),
      trigger: requiredString(input.trigger, "trigger"),
      status: optionalString(input.status) ?? "active",
      priority: numberValue(input.priority, 100),
      mode: optionalString(input.mode) ?? "suggest",
      conditions: JSON.stringify(conditions),
      actions: JSON.stringify(actions),
      stopProcessing: Boolean(input.stopProcessing),
      createdByUserId: actor.userId,
    },
    include: { createdByUser: true, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  })

  await auditAction({
    actor: actor.actor,
    action: "rule.create",
    targetType: "rule",
    targetId: rule.id,
    metadata: { trigger: rule.trigger, mode: rule.mode },
  })
  return formatRule(rule)
}

export async function updateRule(id: string, input: RuleInput, actor: AccessActor) {
  const existing = await db.rule.findUnique({ where: { id }, select: { id: true } })
  if (!existing) throw notFound("Rule not found", { id })

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = requiredString(input.name, "name")
  if (input.description !== undefined) patch.description = optionalString(input.description)
  if (input.trigger !== undefined) patch.trigger = requiredString(input.trigger, "trigger")
  if (input.status !== undefined) patch.status = requiredString(input.status, "status")
  if (input.priority !== undefined) patch.priority = numberValue(input.priority, 100)
  if (input.mode !== undefined) patch.mode = requiredString(input.mode, "mode")
  if (input.conditions !== undefined) patch.conditions = JSON.stringify(parseJsonArray(input.conditions, "conditions"))
  if (input.actions !== undefined) patch.actions = JSON.stringify(parseJsonArray(input.actions, "actions"))
  if (input.stopProcessing !== undefined) patch.stopProcessing = Boolean(input.stopProcessing)

  const rule = await db.rule.update({
    where: { id },
    data: patch,
    include: { createdByUser: true, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  })
  await auditAction({
    actor: actor.actor,
    action: "rule.update",
    targetType: "rule",
    targetId: id,
    metadata: { fields: Object.keys(patch) },
  })
  return formatRule(rule)
}

export async function testRule(input: { ruleId?: string | null; rule?: RuleInput; payload?: unknown; targetType?: string | null; targetId?: string | null }, actor: AccessActor) {
  const payload = objectValue(input.payload)
  const rule = input.ruleId
    ? await db.rule.findUnique({ where: { id: input.ruleId } })
    : null

  const evaluatedRule = rule
    ? {
      id: rule.id,
      trigger: rule.trigger,
      mode: rule.mode,
      conditions: parseStoredArray(rule.conditions),
      actions: parseStoredArray(rule.actions),
      stopProcessing: rule.stopProcessing,
    }
    : {
      id: null,
      trigger: requiredString(input.rule?.trigger, "trigger"),
      mode: optionalString(input.rule?.mode) ?? "dry_run",
      conditions: parseJsonArray(input.rule?.conditions, "conditions"),
      actions: parseJsonArray(input.rule?.actions, "actions"),
      stopProcessing: Boolean(input.rule?.stopProcessing),
    }

  if (input.ruleId && !rule) throw notFound("Rule not found", { id: input.ruleId })

  const result = evaluateRule(evaluatedRule.conditions as RuleCondition[], evaluatedRule.actions as RuleAction[], payload)
  let run = null
  if (evaluatedRule.id) {
    run = await db.ruleRun.create({
      data: {
        ruleId: evaluatedRule.id,
        trigger: evaluatedRule.trigger,
        targetType: optionalString(input.targetType),
        targetId: optionalString(input.targetId),
        matched: result.matched,
        mode: evaluatedRule.mode,
        status: "dry_run",
        input: JSON.stringify(payload),
        actionsPlanned: JSON.stringify(result.actionsPlanned),
        actionsApplied: JSON.stringify([]),
        message: result.message,
      },
    })
  }

  await auditAction({
    actor: actor.actor,
    action: "rule.run",
    targetType: "rule",
    targetId: evaluatedRule.id,
    metadata: { trigger: evaluatedRule.trigger, matched: result.matched, status: "dry_run" },
  })

  return { ...result, run }
}

export async function listRuleRuns(ruleId?: string | null) {
  const runs = await db.ruleRun.findMany({
    where: ruleId ? { ruleId } : undefined,
    include: { rule: true },
    orderBy: { createdAt: "desc" },
    take: 150,
  })
  return {
    runs: runs.map(run => ({
      ...run,
      input: parseStoredValue(run.input),
      actionsPlanned: parseStoredValue(run.actionsPlanned),
      actionsApplied: parseStoredValue(run.actionsApplied),
      rule: { id: run.rule.id, name: run.rule.name, trigger: run.rule.trigger },
    })),
  }
}

function evaluateRule(conditions: RuleCondition[], actions: RuleAction[], payload: Record<string, unknown>) {
  const failures: string[] = []
  for (const condition of conditions) {
    if (!matchesCondition(condition, payload)) {
      failures.push(`${condition.field} ${condition.operator}`)
    }
  }
  const matched = failures.length === 0
  return {
    matched,
    actionsPlanned: matched ? actions : [],
    message: matched ? "Rule matched" : `No match: ${failures.join(", ")}`,
  }
}

function matchesCondition(condition: RuleCondition, payload: Record<string, unknown>) {
  const actual = getPath(payload, condition.field)
  switch (condition.operator) {
    case "equals":
      return normalize(actual) === normalize(condition.value)
    case "not_equals":
      return normalize(actual) !== normalize(condition.value)
    case "contains":
      return normalize(actual).includes(normalize(condition.value))
    case "in":
      return Array.isArray(condition.value) && condition.value.map(normalize).includes(normalize(actual))
    case "exists":
      return actual !== undefined && actual !== null && actual !== ""
    case "not_exists":
      return actual === undefined || actual === null || actual === ""
    default:
      return false
  }
}

function getPath(payload: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, payload)
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function parseJsonArray(value: unknown, field: string) {
  if (Array.isArray(value)) return value
  if (typeof value !== "string" || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) throw new Error("not array")
    return parsed
  } catch {
    throw badRequest(`${field} must be a JSON array`, { field })
  }
}

function parseStoredArray(value: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseStoredValue(value: string | null) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function objectValue(value: unknown) {
  if (!value) return {}
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch {
      throw badRequest("payload must be a JSON object", { field: "payload" })
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberValue(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) throw badRequest("priority must be a number", { field: "priority" })
  return number
}

function formatRule(rule: {
  id: string
  createdAt: Date
  updatedAt: Date
  name: string
  description: string | null
  trigger: string
  status: string
  priority: number
  mode: string
  conditions: string
  actions: string
  stopProcessing: boolean
  createdByUser?: { id: string; email: string; name: string | null } | null
  runs?: { createdAt: Date; matched: boolean; status: string; message: string | null }[]
}) {
  return {
    ...rule,
    conditions: parseStoredArray(rule.conditions),
    actions: parseStoredArray(rule.actions),
    createdByUser: rule.createdByUser ? {
      id: rule.createdByUser.id,
      email: rule.createdByUser.email,
      name: rule.createdByUser.name,
    } : null,
    lastRun: rule.runs?.[0] ?? null,
    runs: undefined,
  }
}
