// Moved to @life-os/automation (Track A5) so apps/api and any future
// consumer share the exact same rules engine this app already proved out in
// production, rather than a rewrite — nothing to convert (prod held 1 rule
// and 0 runs). @life-os/automation throws a generic RuleError (it can't
// depend on this app's AppError/HTTP shape); this shim translates that back
// so this app's existing route handlers keep producing the same responses
// they always have.

import { badRequest, notFound } from "@/server/api/errors"
import {
  listRules as sharedListRules,
  createRule as sharedCreateRule,
  updateRule as sharedUpdateRule,
  deleteRule as sharedDeleteRule,
  testRule as sharedTestRule,
  runRulesForTarget as sharedRunRulesForTarget,
  listRuleRuns as sharedListRuleRuns,
  applyRuleRunSuggestions as sharedApplyRuleRunSuggestions,
  RuleError,
  type RuleExecutionInput,
  type RuleInput,
  type RuleRunFilters,
} from "@life-os/automation"
import type { AccessActor } from "./access"

export type { RuleExecutionInput, RuleInput, RuleRunFilters }

function translate<T>(promise: Promise<T>): Promise<T> {
  return promise.catch(error => {
    if (error instanceof RuleError) throw error.code === "not_found" ? notFound(error.message) : badRequest(error.message)
    throw error
  })
}

export function listRules(workspaceId?: string) {
  return sharedListRules(workspaceId)
}

export function createRule(input: RuleInput, actor: AccessActor) {
  return translate(sharedCreateRule(input, actor))
}

export function updateRule(id: string, input: RuleInput, actor: AccessActor) {
  return translate(sharedUpdateRule(id, input, actor))
}

export function deleteRule(id: string, actor: AccessActor) {
  return translate(sharedDeleteRule(id, actor))
}

export function testRule(
  input: { ruleId?: string | null; rule?: RuleInput; payload?: unknown; targetType?: string | null; targetId?: string | null },
  actor: AccessActor,
) {
  return translate(sharedTestRule(input, actor))
}

export function runRulesForTarget(input: RuleExecutionInput) {
  return sharedRunRulesForTarget(input)
}

export function listRuleRuns(filters?: RuleRunFilters, workspaceId?: string) {
  return sharedListRuleRuns(filters, workspaceId)
}

export function applyRuleRunSuggestions(ruleRunIds: string[], targetId: string, actor?: RuleExecutionInput["actor"]) {
  return sharedApplyRuleRunSuggestions(ruleRunIds, targetId, actor)
}
