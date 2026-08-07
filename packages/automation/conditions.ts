import type { z } from "@life-os/contracts"
import { ruleConditionContract, ruleConditionsContract } from "@life-os/contracts"

export type RuleCondition = z.infer<typeof ruleConditionContract>

export function evaluateConditions(
  conditions: RuleCondition[],
  payload: Record<string, unknown>,
): { matched: boolean; failures: string[] } {
  const failures: string[] = []
  for (const condition of conditions) {
    if (!matchesCondition(condition, payload)) {
      failures.push(`${condition.field} ${condition.operator}`)
    }
  }
  return { matched: failures.length === 0, failures }
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

export { ruleConditionContract, ruleConditionsContract }
