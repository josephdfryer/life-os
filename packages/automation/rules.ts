import type { Prisma } from "@life-os/db"
import {
  decodeStoredJson,
  encodeStoredJson,
  ruleActionsContract,
  ruleConditionsContract,
} from "@life-os/contracts"
import type { AccessActor } from "@life-os/access"
import { writeAuditLog, createReviewItem, type AuditActor, type GraphEventActor } from "@life-os/domain"
import { evaluateConditions, type RuleCondition } from "./conditions"
import { getRegisteredAction, type RuleAction } from "./actions"
import { getTriggerSchema } from "./triggers"

// packages/automation/rules.ts — moved from apps/persons/server/domain/
// rules.ts (Track A5). Same trigger/condition/action vocabulary that file
// already proved out in production (nothing to convert: prod held 1 rule
// and 0 runs), plus what that file didn't have:
//   - versioned rules: Rule.version bumps on every edit, each RuleRun
//     denormalizes the ruleVersion it ran under, so a run stays
//     interpretable after the rule is later changed.
//   - a causation-depth cap, mirroring GraphEvent's, so a rule chain that
//     fires its own trigger can't loop forever.
//   - authority as a property of the action (see actions.ts), not the
//     rule's mode — enforced here in the executor.
//   - a genuinely pure replay: evaluate a rule against a payload with zero
//     writes, not even a RuleRun row (testRule below still writes one, for
//     the existing Admin "test this rule" UI's history).

export class RuleError extends Error {
  code: "not_found" | "validation"
  constructor(message: string, code: "not_found" | "validation") {
    super(message)
    this.name = "RuleError"
    this.code = code
  }
}

// Same cap as packages/domain/events.ts's MAX_CAUSATION_DEPTH, kept as an
// independent constant rather than importing it — automation's causation
// chain (rule → action → new trigger → rule) is conceptually the same
// safety property as GraphEvent's, but a different counter: an action can
// fire a new trigger without ever publishing a GraphEvent, and vice versa.
export const MAX_CAUSATION_DEPTH = 5

type EvaluatedRule = {
  id: string
  version: number
  trigger: string
  mode: string
  conditions: RuleCondition[]
  actions: RuleAction[]
  stopProcessing: boolean
}

// 30s TTL per workspace+trigger, same as the file this replaced — Fluid
// Compute reuses instances, so this is effective in production. Invalidated
// whenever a rule is written.
const _rulesCache = new Map<string, { value: EvaluatedRule[]; expiresAt: number }>()

function _invalidateRulesCache(workspaceId: string) {
  for (const key of _rulesCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) _rulesCache.delete(key)
  }
}

async function _loadActiveRules(workspaceId: string, trigger: string): Promise<EvaluatedRule[]> {
  const { db } = await import("@life-os/db")
  const key = `${workspaceId}:${trigger}`
  const cached = _rulesCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const rows = await db.rule.findMany({
    where: { workspaceId, trigger, status: "active" },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  })
  const value: EvaluatedRule[] = rows.map(r => ({
    id: r.id,
    version: r.version,
    trigger: r.trigger,
    mode: r.mode,
    conditions: decodeStoredJson(r.conditions, ruleConditionsContract, "Rule.conditions", []),
    actions: decodeStoredJson(r.actions, ruleActionsContract, "Rule.actions", []),
    stopProcessing: r.stopProcessing,
  }))
  _rulesCache.set(key, { value, expiresAt: Date.now() + 30_000 })
  return value
}

export type RuleExecutionInput = {
  trigger: string
  payload: Record<string, unknown>
  targetType?: string | null
  targetId?: string | null
  actor?: (GraphEventActor & AuditActor) | undefined
  apply?: boolean
  /** Present when this run was itself caused by another rule's action, not a direct app event. Omit for a direct trigger. */
  causationDepth?: number
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
  const { db } = await import("@life-os/db")
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
  const { db } = await import("@life-os/db")
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
      version: 1,
      createdByUserId: actor.userId,
    },
    include: { createdByUser: true, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  })

  _invalidateRulesCache(actor.workspaceId)
  await writeAuditLog({
    actor: actor.actor,
    action: "rule.create",
    targetType: "rule",
    targetId: rule.id,
    metadata: { trigger: rule.trigger, mode: rule.mode },
  })
  return formatRule(rule)
}

export async function updateRule(id: string, input: RuleInput, actor: AccessActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.rule.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true, version: true } })
  if (!existing) throw new RuleError("Rule not found", "not_found")

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
  // Any real edit bumps the version — every RuleRun from this point on
  // denormalizes it, so "what did this rule look like when it ran" stays
  // answerable even after later edits.
  if (Object.keys(patch).length) patch.version = existing.version + 1

  const rule = await db.rule.update({
    where: { id },
    data: patch,
    include: { createdByUser: true, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  })
  _invalidateRulesCache(actor.workspaceId)
  await writeAuditLog({
    actor: actor.actor,
    action: "rule.update",
    targetType: "rule",
    targetId: id,
    metadata: { fields: Object.keys(patch) },
  })
  return formatRule(rule)
}

export async function deleteRule(id: string, actor: AccessActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.rule.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true } })
  if (!existing) throw new RuleError("Rule not found", "not_found")
  await db.rule.delete({ where: { id } })
  _invalidateRulesCache(actor.workspaceId)
  await writeAuditLog({ actor: actor.actor, action: "rule.delete", targetType: "rule", targetId: id })
}

export async function testRule(
  input: { ruleId?: string | null; rule?: RuleInput; payload?: unknown; targetType?: string | null; targetId?: string | null },
  actor: AccessActor,
) {
  const { db } = await import("@life-os/db")
  const payload = objectValue(input.payload)
  const rule = input.ruleId
    ? await db.rule.findFirst({ where: { id: input.ruleId, workspaceId: actor.workspaceId } })
    : null
  if (input.ruleId && !rule) throw new RuleError("Rule not found", "not_found")

  const evaluatedRule: EvaluatedRule = rule
    ? {
      id: rule.id,
      version: rule.version,
      trigger: rule.trigger,
      mode: rule.mode,
      conditions: decodeStoredJson(rule.conditions, ruleConditionsContract, "Rule.conditions", []),
      actions: decodeStoredJson(rule.actions, ruleActionsContract, "Rule.actions", []),
      stopProcessing: rule.stopProcessing,
    }
    : {
      id: "",
      version: 1,
      trigger: requiredString(input.rule?.trigger, "trigger"),
      mode: optionalString(input.rule?.mode) ?? "dry_run",
      conditions: parseJsonArray(input.rule?.conditions, "conditions"),
      actions: parseJsonArray(input.rule?.actions, "actions"),
      stopProcessing: Boolean(input.rule?.stopProcessing),
    }

  const result = evaluateConditions(evaluatedRule.conditions, payload)
  const actionsPlanned = result.matched ? evaluatedRule.actions : []
  const message = result.matched ? "Rule matched" : `No match: ${result.failures.join(", ")}`

  let run = null
  if (rule) {
    run = await db.ruleRun.create({
      data: {
        ruleId: rule.id,
        workspaceId: actor.workspaceId,
        ruleVersion: rule.version,
        trigger: evaluatedRule.trigger,
        targetType: optionalString(input.targetType),
        targetId: optionalString(input.targetId),
        matched: result.matched,
        mode: evaluatedRule.mode,
        status: "dry_run",
        input: JSON.stringify(payload),
        actionsPlanned: JSON.stringify(actionsPlanned),
        actionsApplied: JSON.stringify([]),
        message,
      },
    })
  }

  await writeAuditLog({
    actor: actor.actor,
    action: "rule.run",
    targetType: "rule",
    targetId: evaluatedRule.id || null,
    metadata: { trigger: evaluatedRule.trigger, matched: result.matched, status: "dry_run" },
  })

  return { matched: result.matched, actionsPlanned, message, run }
}

/**
 * Evaluate a rule against a payload with zero writes — not even a RuleRun
 * row. For previewing "what would this rule do" (an admin UI's live preview
 * while editing conditions, an automated test in CI) without touching
 * history. testRule above is the audited version used by the existing
 * "test this rule" action; this is the pure one.
 */
export function replayRule(conditions: RuleCondition[], actions: RuleAction[], payload: Record<string, unknown>) {
  const result = evaluateConditions(conditions, payload)
  return {
    matched: result.matched,
    actionsPlanned: result.matched ? actions : [],
    message: result.matched ? "Rule matched" : `No match: ${result.failures.join(", ")}`,
  }
}

export async function runRulesForTarget(input: RuleExecutionInput) {
  const { db } = await import("@life-os/db")
  const workspaceId = input.actor?.workspaceId ?? "default-workspace"
  const causationDepth = input.causationDepth ?? 0

  if (causationDepth > MAX_CAUSATION_DEPTH) {
    console.warn(`[automation] causation depth ${causationDepth} exceeds ${MAX_CAUSATION_DEPTH} — halting rule chain for trigger "${input.trigger}"`)
    return { trigger: input.trigger, matched: false, blocked: false, runCount: 0, actionsPlanned: [] as RuleAction[], actionsApplied: [] as RuleAction[], haltedOnCausationDepth: true }
  }

  // Validate against the trigger's declared shape when one is registered —
  // a mismatch is logged, not thrown, since a caller mid-migration to a new
  // payload shape shouldn't have its real work fail because of this.
  const schema = getTriggerSchema(input.trigger)
  const parsed = schema.safeParse(input.payload)
  if (!parsed.success) {
    console.warn(`[automation] payload for trigger "${input.trigger}" does not match its registered schema:`, parsed.error.issues[0]?.message)
  }

  const rules = await _loadActiveRules(workspaceId, input.trigger)

  const runData: Prisma.RuleRunCreateManyInput[] = []
  const actionsPlanned: RuleAction[] = []
  const actionsApplied: RuleAction[] = []
  const auditEvents: Parameters<typeof writeAuditLog>[0][] = []
  let matched = false
  let blocked = false

  for (const rule of rules) {
    const result = evaluateConditions(rule.conditions, input.payload)
    const ruleMatched = result.matched
    const planned = ruleMatched ? rule.actions : []
    const applied = ruleMatched && input.apply && shouldApply(rule.mode)
      ? await applyActions(planned, {
          workspaceId,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          actor: input.actor,
          ruleId: rule.id,
          ruleVersion: rule.version,
        })
      : []
    const status = runStatus(rule.mode, ruleMatched, input.apply, applied.length)

    if (ruleMatched && rule.mode === "block") blocked = true
    if (ruleMatched) matched = true
    actionsPlanned.push(...planned)
    actionsApplied.push(...applied)

    runData.push({
      ruleId: rule.id,
      workspaceId,
      ruleVersion: rule.version,
      trigger: input.trigger,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      matched: ruleMatched,
      mode: rule.mode,
      status,
      input: JSON.stringify(input.payload),
      actionsPlanned: JSON.stringify(planned),
      actionsApplied: JSON.stringify(applied),
      message: ruleMatched ? "Rule matched" : `No match: ${result.failures.join(", ")}`,
      causationDepth,
    })

    if (ruleMatched) {
      auditEvents.push({
        actor: input.actor,
        action: applied.length ? "rule.apply" : "rule.run",
        targetType: input.targetType ?? "rule",
        targetId: input.targetId ?? rule.id,
        metadata: { ruleId: rule.id, ruleVersion: rule.version, trigger: input.trigger, mode: rule.mode, actionsApplied: applied.length },
      })
    }

    if (ruleMatched && rule.stopProcessing) break
  }

  // Batch all writes: 1 RTT instead of N
  await Promise.all([
    runData.length ? db.ruleRun.createMany({ data: runData }) : Promise.resolve(),
    ...auditEvents.map(e => writeAuditLog(e)),
  ])

  return { trigger: input.trigger, matched, blocked, runCount: runData.length, actionsPlanned, actionsApplied }
}

async function applyActions(
  actions: RuleAction[],
  ctx: {
    workspaceId: string
    targetType: string | null
    targetId: string | null
    actor?: GraphEventActor & AuditActor
    ruleId: string
    ruleVersion: number
  },
): Promise<RuleAction[]> {
  const applied: RuleAction[] = []
  for (const [actionIndex, action] of actions.entries()) {
    const registered = getRegisteredAction(action.type)
    if (!registered) continue // unknown action type — nothing to run, same as the old rules.ts's silent fall-through

    // Only observe and safe_auto ever execute automatically. review/confirm
    // tier actions become a ReviewItem proposal instead of silently
    // vanishing — accepting it re-runs this exact action for real via the
    // "automation.apply_action" command registered in actions.ts. Source id
    // is deterministic per (rule version, target, action position), so
    // re-evaluating the same definition refreshes its pending proposals while
    // two actions of the same type remain independently reviewable.
    if (registered.authorityTier !== "observe" && registered.authorityTier !== "safe_auto") {
      await createReviewItem({
        workspaceId: ctx.workspaceId,
        source: "rule",
        sourceId: `${ctx.ruleId}:v${ctx.ruleVersion}:${ctx.targetType ?? "none"}:${ctx.targetId ?? "none"}:${actionIndex}:${action.type}`,
        itemType: ctx.targetType ?? "rule",
        command: "automation.apply_action",
        commandInput: { actionType: action.type, action, targetType: ctx.targetType, targetId: ctx.targetId },
        targetType: ctx.targetType,
        targetId: ctx.targetId,
        riskTier: registered.authorityTier,
      })
      continue
    }

    const result = await registered.execute(action, ctx)
    if (result) applied.push(result)
  }
  return applied
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
  const { db } = await import("@life-os/db")
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

export async function applyRuleRunSuggestions(ruleRunIds: string[], targetId: string, actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  if (!ruleRunIds.length) return { applied: [] as RuleAction[], updatedRunIds: [] as string[] }

  const runs = await db.ruleRun.findMany({
    where: { id: { in: ruleRunIds }, targetId, status: "suggested", workspaceId: actor?.workspaceId ?? "default-workspace" },
    select: { id: true, actionsPlanned: true, ruleId: true, ruleVersion: true },
  })

  const allApplied: RuleAction[] = []
  const updatedRunIds: string[] = []
  const workspaceId = actor?.workspaceId ?? "default-workspace"

  for (const run of runs) {
    const planned = decodeStoredJson(run.actionsPlanned, ruleActionsContract, "RuleRun.actionsPlanned", [])
    if (!planned.length) continue

    const applied = await applyActions(planned, {
      workspaceId,
      targetType: "stagedInteraction",
      targetId,
      actor,
      ruleId: run.ruleId,
      ruleVersion: run.ruleVersion,
    })
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

function parseMatchedFilter(value: string | null | undefined) {
  const normalized = normalize(value)
  if (["matched", "true", "1", "yes"].includes(normalized)) return true
  if (["skipped", "false", "0", "no"].includes(normalized)) return false
  return null
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
    throw new RuleError(`${field} must be a JSON array`, "validation")
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
      throw new RuleError("payload must be a JSON object", "validation")
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberValue(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) throw new RuleError("priority must be a number", "validation")
  return number
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new RuleError(`${field} is required`, "validation")
  return value.trim()
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null
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
  version: number
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
