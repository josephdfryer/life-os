import type { z } from "@life-os/contracts"
import { ruleActionContract } from "@life-os/contracts"
import type { GraphEventActor, AuditActor } from "@life-os/domain"

// Authority is a property of the ACTION, not the rule's mode — a "suggest"
// mode rule and an "auto" mode rule run the exact same action handlers; what
// differs is whether the executor (rules.ts) is allowed to let the result
// actually apply. See ~/.claude/plans/serialized-bubbling-pearl.md's
// Authority table:
//   observe    read-only, automatic
//   safe_auto  reversible enrichment, automatic once a rule's mode says so
//   review     never auto-applies — becomes a proposal (ReviewItem territory)
//   confirm    never auto-applies, ever — merges/deletes/money/outbound
// None of the four built-in actions below are review/confirm tier today
// (they only ever touch StagedInteraction queue fields and Person.tags,
// never a canonical primitive's authoritative record) — but the tier is a
// property every future action must declare, not something bolted on later.
export type ActionAuthorityTier = "observe" | "safe_auto" | "review" | "confirm"

export type RuleAction = z.infer<typeof ruleActionContract>

export type ActionContext = {
  workspaceId: string
  targetType: string | null
  targetId: string | null
  actor?: GraphEventActor & AuditActor
}

/** Returns the action (possibly normalized) if it actually applied, or null if there was nothing to do. */
export type ActionExecutor = (action: RuleAction, ctx: ActionContext) => Promise<RuleAction | null>

export type RegisteredAction = {
  type: string
  authorityTier: ActionAuthorityTier
  execute: ActionExecutor
}

const ACTION_REGISTRY = new Map<string, RegisteredAction>()

export function registerAction(action: RegisteredAction) {
  ACTION_REGISTRY.set(action.type, action)
}

export function getRegisteredAction(type: string): RegisteredAction | undefined {
  return ACTION_REGISTRY.get(normalize(type))
}

export function listRegisteredActions(): RegisteredAction[] {
  return [...ACTION_REGISTRY.values()]
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

const STAGED_INTERACTION_FIELDS = new Set([
  "candidatePersonId", "confidence", "matchReason", "status", "summary",
  "direction", "contactName", "contactEmail", "contactPhone", "priority",
])

registerAction({
  type: "block",
  authorityTier: "safe_auto",
  async execute(action, ctx) {
    if (ctx.targetType !== "stagedInteraction" || !ctx.targetId) return null
    const { db } = await import("@life-os/db")
    await db.stagedInteraction.update({ where: { id: ctx.targetId }, data: { status: "blocked" } })
    return { type: action.type, field: "status", value: "blocked" }
  },
})

async function setStagedInteractionField(action: RuleAction, ctx: ActionContext): Promise<RuleAction | null> {
  if (ctx.targetType !== "stagedInteraction" || !ctx.targetId) return null
  if (!action.field || !STAGED_INTERACTION_FIELDS.has(action.field)) return null
  const { db } = await import("@life-os/db")
  await db.stagedInteraction.update({ where: { id: ctx.targetId }, data: { [action.field]: action.value } })
  return action
}

// Three names, one behavior — matches the vocabulary rules already used in
// production before this move; kept as aliases rather than picking one so
// no existing Rule row's stored actions JSON needs rewriting.
for (const type of ["set", "set_field", "assign"]) {
  registerAction({ type, authorityTier: "safe_auto", execute: setStagedInteractionField })
}

async function applyPersonTag(action: RuleAction, ctx: ActionContext, mode: "add" | "remove"): Promise<RuleAction | null> {
  if (ctx.targetType !== "stagedInteraction" || !ctx.targetId) return null
  const tag = String(action.value ?? "").trim()
  if (!tag) return null

  const { db } = await import("@life-os/db")
  const { decodeStoredJson, storedStringList } = await import("@life-os/contracts")

  const staged = await db.stagedInteraction.findFirst({
    where: { id: ctx.targetId, workspaceId: ctx.workspaceId },
    select: { candidatePersonId: true },
  })
  if (!staged?.candidatePersonId) return null

  const person = await db.person.findFirst({
    where: { id: staged.candidatePersonId, workspaceId: ctx.workspaceId },
    select: { id: true, tags: true },
  })
  if (!person) return null

  const tags = decodeStoredJson(person.tags, storedStringList, "Person.tags", [])
  const hasTag = tags.includes(tag)
  if (mode === "add" && hasTag) return null // already tagged, nothing changed
  if (mode === "remove" && !hasTag) return null // tag wasn't present

  const next = mode === "add" ? [...tags, tag] : tags.filter(t => t !== tag)
  await db.person.update({ where: { id: person.id }, data: { tags: JSON.stringify(next) } })
  return action
}

registerAction({
  type: "add_tag",
  authorityTier: "safe_auto",
  execute: (action, ctx) => applyPersonTag(action, ctx, "add"),
})

registerAction({
  type: "remove_tag",
  authorityTier: "safe_auto",
  execute: (action, ctx) => applyPersonTag(action, ctx, "remove"),
})
