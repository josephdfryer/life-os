import { db } from "@/lib/db"
import type { Prisma } from "@life-os/db"
import {
  decodeStoredJson,
  encodeStoredJson,
  ruleActionsContract,
  ruleConditionsContract,
  storedStringList,
} from "@life-os/contracts"
import { badRequest, notFound, optionalString, requiredString } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import type { AccessActor } from "./access"

// 30s TTL per workspace+trigger — Fluid Compute reuses instances, so this is
// effective in production. Invalidated whenever a rule is written.
const _rulesCache = new Map<string, { value: EvaluatedRule[]; expiresAt: number }>()

function _invalidateRulesCache(workspaceId: string) {
  for (const key of _rulesCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) _rulesCache.delete(key)
  }
}

async function _loadActiveRules(workspaceId: string, trigger: string): Promise<EvaluatedRule[]> {
  const key = `${workspaceId}:${trigger}`
  const cached = _rulesCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const rows = await db.rule.findMany({
    where: { workspaceId, trigger, status: "active" },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  })
  const value: EvaluatedRule[] = rows.map(r => ({
    id: r.id,
    trigger: r.trigger,
    mode: r.mode,
    conditions: decodeStoredJson(r.conditions, ruleConditionsContract, "Rule.conditions", []),
    actions: decodeStoredJson(r.actions, ruleActionsContract, "Rule.actions", []),
    stopProcessing: r.stopProcessing,
  }))
  _rulesCache.set(key, { value, expiresAt: Date.now() + 30_000 })
  return value
}

type RuleCondition = {
  field: string
  operator: "equals" | "not_equals" | "contains" | "in" | "exists" | "not_exists" | "gte" | "lte"
  value?: unknown
}

type RuleAction = {
  type: string
  field?: string
  value?: unknown
}

type EvaluatedRule = {
  id: string
  trigger: string
  mode: string
  conditions: RuleCondition[]
  actions: RuleAction[]
  stopProcessing: boolean
}

export type RuleExecutionInput = {
  trigger: string
  payload: Record<string, unknown>
  targetType?: string | null
  targetId?: string | null
  actor?: DomainActor
  apply?: boolean
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

export async function listRules(workspaceId = "default-workspace") {
  const [rules, runCount] = await Promise.all([
    db.rule.findMany({
      where: { workspaceId },
      include: { createdByUser: true, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    }),
    db.ruleRun.count({ where: { workspaceId } }),
  ])
  return { rules: rules.map(formatRule), runCount }
}

export async function createRule(input: RuleInput, actor: AccessActor) {
  const conditions = parseJsonArray(input.conditions, "conditions")
  const actions = parseJsonArray(input.actions, "actions")
  const rule = await db.rule.create({
    data: {
      name: requiredString(input.name, "name"),
      workspaceId: actor.workspaceId,
      description: optionalString(input.description),
      trigger: requiredString(input.trigger, "trigger"),
      status: optionalString(input.status) ?? "active",
      priority: numberValue(input.priority, 100),
      mode: optionalString(input.mode) ?? "suggest",
      conditions: encodeStoredJson(conditions, ruleConditionsContract, "Rule.conditions"),
      actions: encodeStoredJson(actions, ruleActionsContract, "Rule.actions"),
      stopProcessing: Boolean(input.stopProcessing),
      createdByUserId: actor.userId,
    },
    include: { createdByUser: true, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  })

  _invalidateRulesCache(actor.workspaceId)
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
  const existing = await db.rule.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true } })
  if (!existing) throw notFound("Rule not found", { id })

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = requiredString(input.name, "name")
  if (input.description !== undefined) patch.description = optionalString(input.description)
  if (input.trigger !== undefined) patch.trigger = requiredString(input.trigger, "trigger")
  if (input.status !== undefined) patch.status = requiredString(input.status, "status")
  if (input.priority !== undefined) patch.priority = numberValue(input.priority, 100)
  if (input.mode !== undefined) patch.mode = requiredString(input.mode, "mode")
  if (input.conditions !== undefined) patch.conditions = encodeStoredJson(parseJsonArray(input.conditions, "conditions"), ruleConditionsContract, "Rule.conditions")
  if (input.actions !== undefined) patch.actions = encodeStoredJson(parseJsonArray(input.actions, "actions"), ruleActionsContract, "Rule.actions")
  if (input.stopProcessing !== undefined) patch.stopProcessing = Boolean(input.stopProcessing)

  const rule = await db.rule.update({
    where: { id },
    data: patch,
    include: { createdByUser: true, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  })
  _invalidateRulesCache(actor.workspaceId)
  await auditAction({
    actor: actor.actor,
    action: "rule.update",
    targetType: "rule",
    targetId: id,
    metadata: { fields: Object.keys(patch) },
  })
  return formatRule(rule)
}

export async function deleteRule(id: string, actor: AccessActor) {
  const existing = await db.rule.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true } })
  if (!existing) throw notFound("Rule not found", { id })
  await db.rule.delete({ where: { id } })
  _invalidateRulesCache(actor.workspaceId)
  await auditAction({ actor: actor.actor, action: "rule.delete", targetType: "rule", targetId: id })
}

export async function testRule(input: { ruleId?: string | null; rule?: RuleInput; payload?: unknown; targetType?: string | null; targetId?: string | null }, actor: AccessActor) {
  const payload = objectValue(input.payload)
  const rule = input.ruleId
    ? await db.rule.findFirst({ where: { id: input.ruleId, workspaceId: actor.workspaceId } })
    : null

  const evaluatedRule = rule
    ? {
      id: rule.id,
      trigger: rule.trigger,
      mode: rule.mode,
      conditions: decodeStoredJson(rule.conditions, ruleConditionsContract, "Rule.conditions", []),
      actions: decodeStoredJson(rule.actions, ruleActionsContract, "Rule.actions", []),
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
        workspaceId: actor.workspaceId,
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

export async function runRulesForTarget(input: RuleExecutionInput) {
  const workspaceId = input.actor?.workspaceId ?? "default-workspace"
  const rules = await _loadActiveRules(workspaceId, input.trigger)

  const runData: Prisma.RuleRunCreateManyInput[] = []
  const actionsPlanned: RuleAction[] = []
  const actionsApplied: RuleAction[] = []
  const auditEvents: Parameters<typeof auditAction>[0][] = []
  let matched = false
  let blocked = false

  for (const rule of rules) {
    const result = evaluateRule(rule.conditions, rule.actions, input.payload)
    const ruleMatched = result.matched
    const planned = ruleMatched ? result.actionsPlanned : []
    const applied = ruleMatched && input.apply && shouldApply(rule.mode)
      ? await applyRuleActions(planned, input)
      : []
    const status = runStatus(rule.mode, ruleMatched, input.apply, applied.length)

    if (ruleMatched && rule.mode === "block") blocked = true
    if (ruleMatched) matched = true
    actionsPlanned.push(...planned)
    actionsApplied.push(...applied)

    runData.push({
      ruleId: rule.id,
      workspaceId,
      trigger: input.trigger,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      matched: ruleMatched,
      mode: rule.mode,
      status,
      input: JSON.stringify(input.payload),
      actionsPlanned: JSON.stringify(planned),
      actionsApplied: JSON.stringify(applied),
      message: result.message,
    })

    if (ruleMatched) {
      auditEvents.push({
        actor: input.actor,
        action: applied.length ? "rule.apply" : "rule.run",
        targetType: input.targetType ?? "rule",
        targetId: input.targetId ?? rule.id,
        metadata: { ruleId: rule.id, trigger: input.trigger, mode: rule.mode, actionsApplied: applied.length },
      })
    }

    if (ruleMatched && rule.stopProcessing) break
  }

  // Batch all writes: 1 RTT instead of N
  await Promise.all([
    runData.length ? db.ruleRun.createMany({ data: runData }) : Promise.resolve(),
    ...auditEvents.map(e => auditAction(e)),
  ])

  return { trigger: input.trigger, matched, blocked, runCount: runData.length, actionsPlanned, actionsApplied }
}

export type RuleRunFilters = {
  ruleId?: string | null
  trigger?: string | null
  matched?: string | null
  status?: string | null
  targetType?: string | null
  targetId?: string | null
}

export async function listRuleRuns(filters: RuleRunFilters = {}, workspaceId = "default-workspace") {
  const where: Prisma.RuleRunWhereInput = { workspaceId }
  if (filters.ruleId) where.ruleId = filters.ruleId
  if (filters.trigger) where.trigger = filters.trigger
  if (filters.status) where.status = filters.status
  if (filters.targetType) where.targetType = filters.targetType
  if (filters.targetId) where.targetId = filters.targetId
  const matched = parseMatchedFilter(filters.matched)
  if (matched !== null) where.matched = matched

  const runs = await db.ruleRun.findMany({
    where,
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

function parseMatchedFilter(value: string | null | undefined) {
  const normalized = normalize(value)
  if (["matched", "true", "1", "yes"].includes(normalized)) return true
  if (["skipped", "false", "0", "no"].includes(normalized)) return false
  return null
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
    case "gte":
      return Number(actual) >= Number(condition.value)
    case "lte":
      return Number(actual) <= Number(condition.value)
    default:
      return false
  }
}

function shouldApply(mode: string) {
  return mode === "auto" || mode === "block"
}

function runStatus(mode: string, matched: boolean, apply: boolean | undefined, appliedCount: number) {
  if (!matched) return "skipped"
  if (mode === "dry_run") return "dry_run"
  if (mode === "suggest") return "suggested"
  if (mode === "block") return apply ? "blocked" : "planned"
  if (mode === "auto") return appliedCount > 0 ? "applied" : "planned"
  return apply ? "processed" : "planned"
}

async function applyRuleActions(actions: RuleAction[], input: RuleExecutionInput) {
  if (input.targetType !== "stagedInteraction" || !input.targetId) return []
  const workspaceId = input.actor?.workspaceId ?? "default-workspace"

  const patch: Record<string, unknown> = {}
  const applied: RuleAction[] = []
  const personTagActions: RuleAction[] = []

  for (const action of actions) {
    const type = normalize(action.type)
    if (type === "block") {
      patch.status = "blocked"
      applied.push({ type: action.type, field: "status", value: "blocked" })
      continue
    }
    if (type === "add_tag" || type === "remove_tag") {
      personTagActions.push(action)
      continue
    }
    if (!["set", "set_field", "assign"].includes(type) || !action.field) continue
    if (!isStagedInteractionField(action.field)) continue
    patch[action.field] = action.value
    applied.push(action)
  }

  if (Object.keys(patch).length) {
    await db.stagedInteraction.update({
      where: { id: input.targetId },
      data: patch,
    })
  }

  if (personTagActions.length) {
    const tagApplied = await applyPersonTagActions(personTagActions, input.targetId, workspaceId)
    applied.push(...tagApplied)
  }

  return applied
}

async function applyPersonTagActions(actions: RuleAction[], stagedId: string, workspaceId = "default-workspace") {
  const staged = await db.stagedInteraction.findFirst({
    where: { id: stagedId, workspaceId },
    select: { candidatePersonId: true },
  })
  if (!staged?.candidatePersonId) return []

  const person = await db.person.findFirst({
    where: { id: staged.candidatePersonId, workspaceId },
    select: { id: true, tags: true },
  })
  if (!person) return []

  let tags = decodeStoredJson(person.tags, storedStringList, "Person.tags", [])
  const applied: RuleAction[] = []

  for (const action of actions) {
    const tag = String(action.value ?? "").trim()
    if (!tag) continue
    const type = normalize(action.type)
    if (type === "add_tag" && !tags.includes(tag)) {
      tags.push(tag)
      applied.push(action)
    } else if (type === "remove_tag") {
      const before = tags.length
      tags = tags.filter(t => t !== tag)
      if (tags.length < before) applied.push(action)
    }
  }

  if (applied.length) {
    await db.person.update({
      where: { id: person.id },
      data: { tags: JSON.stringify(tags) },
    })
  }

  return applied
}

export async function applyRuleRunSuggestions(
  ruleRunIds: string[],
  targetId: string,
  actor?: DomainActor,
) {
  if (!ruleRunIds.length) return { applied: [] as RuleAction[], updatedRunIds: [] as string[] }

  const runs = await db.ruleRun.findMany({
    where: { id: { in: ruleRunIds }, targetId, status: "suggested", workspaceId: actor?.workspaceId ?? "default-workspace" },
    select: { id: true, actionsPlanned: true },
  })

  const allApplied: RuleAction[] = []
  const updatedRunIds: string[] = []

  for (const run of runs) {
    const planned = decodeStoredJson(run.actionsPlanned, ruleActionsContract, "RuleRun.actionsPlanned", [])
    if (!planned.length) continue

    const applied = await applyPersonTagActions(
      planned.filter(a => ["add_tag", "remove_tag"].includes(normalize(a.type))),
      targetId,
      actor?.workspaceId ?? "default-workspace",
    )

    const stagePatch: Record<string, unknown> = {}
    for (const action of planned) {
      const type = normalize(action.type)
      if (!["set", "set_field", "assign"].includes(type) || !action.field) continue
      if (!isStagedInteractionField(action.field)) continue
      stagePatch[action.field] = action.value
      applied.push(action)
    }
    if (Object.keys(stagePatch).length) {
      await db.stagedInteraction.update({ where: { id: targetId }, data: stagePatch })
    }

    if (applied.length) {
      await db.ruleRun.update({
        where: { id: run.id },
        data: { actionsApplied: JSON.stringify(applied), status: "applied" },
      })
      allApplied.push(...applied)
      updatedRunIds.push(run.id)
    }
  }

  return { applied: allApplied, updatedRunIds }
}

function isStagedInteractionField(field: string) {
  return [
    "candidatePersonId",
    "confidence",
    "matchReason",
    "status",
    "summary",
    "direction",
    "contactName",
    "contactEmail",
    "contactPhone",
    "priority",
  ].includes(field)
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
    conditions: decodeStoredJson(rule.conditions, ruleConditionsContract, "Rule.conditions", []),
    actions: decodeStoredJson(rule.actions, ruleActionsContract, "Rule.actions", []),
    createdByUser: rule.createdByUser ? {
      id: rule.createdByUser.id,
      email: rule.createdByUser.email,
      name: rule.createdByUser.name,
    } : null,
    lastRun: rule.runs?.[0] ?? null,
    runs: undefined,
  }
}
