import { ruleResourceContract, type RuleResource } from "@life-os/contracts"

type FormattedRule = {
  id: string
  createdAt: Date
  updatedAt: Date
  name: string
  description: string | null
  trigger: string
  status: string
  priority: number
  mode: string
  conditions: unknown
  actions: unknown
  stopProcessing: boolean
  version: number
  createdByUser: { id: string; email: string; name: string | null } | null
  lastRun: { createdAt: Date; matched: boolean; status: string; message: string | null } | null
}

// packages/automation's formatRule spreads the raw Prisma row, which also
// carries workspaceId and createdByUserId — reconstructed field by field here
// rather than parsed wholesale, so those never reach the wire.
export function formatRuleResource(rule: FormattedRule): RuleResource {
  return ruleResourceContract.parse({
    id: rule.id,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    name: rule.name,
    description: rule.description,
    trigger: rule.trigger,
    status: rule.status,
    priority: rule.priority,
    mode: rule.mode,
    conditions: rule.conditions,
    actions: rule.actions,
    stopProcessing: rule.stopProcessing,
    version: rule.version,
    createdByUser: rule.createdByUser,
    lastRun: rule.lastRun ? { ...rule.lastRun, createdAt: rule.lastRun.createdAt.toISOString() } : null,
  })
}

type RawRuleRun = {
  id: string
  ruleId: string
  ruleVersion: number
  trigger: string
  targetType: string | null
  targetId: string | null
  matched: boolean
  mode: string
  status: string
  input: string | null
  actionsPlanned: string | null
  actionsApplied: string | null
  message: string | null
  causationDepth: number
  createdAt: Date
} | null

export function formatRuleRunResource(run: RawRuleRun) {
  if (!run) return null
  return {
    id: run.id,
    ruleId: run.ruleId,
    ruleVersion: run.ruleVersion,
    trigger: run.trigger,
    targetType: run.targetType,
    targetId: run.targetId,
    matched: run.matched,
    mode: run.mode,
    status: run.status,
    input: parseJsonSafe(run.input),
    actionsPlanned: parseJsonSafe(run.actionsPlanned),
    actionsApplied: parseJsonSafe(run.actionsApplied),
    message: run.message,
    causationDepth: run.causationDepth,
    createdAt: run.createdAt.toISOString(),
  }
}

function parseJsonSafe(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}
