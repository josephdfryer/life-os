import type { z } from "@life-os/contracts"
import { ruleActionContract } from "@life-os/contracts"
import {
  setInteractionField, InteractionFieldError,
  getPersonTags, setPersonTags,
  type GraphEventActor, type AuditActor,
} from "@life-os/domain"

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
  const staged = await db.stagedInteraction.findFirst({
    where: { id: ctx.targetId, workspaceId: ctx.workspaceId },
    select: { candidatePersonId: true },
  })
  if (!staged?.candidatePersonId) return null

  // Read-then-decide (has the tag already? is it even present to remove?)
  // is automation's judgment call, kept here; the actual write goes through
  // the shared command (Track C) instead of a raw Prisma update.
  const tags = await getPersonTags(staged.candidatePersonId, ctx.workspaceId)
  if (tags === null) return null // no such Person in this workspace

  const hasTag = tags.includes(tag)
  if (mode === "add" && hasTag) return null // already tagged, nothing changed
  if (mode === "remove" && !hasTag) return null // tag wasn't present

  const next = mode === "add" ? [...tags, tag] : tags.filter(t => t !== tag)
  await setPersonTags(staged.candidatePersonId, next, ctx.workspaceId, ctx.actor)
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

// The first action to target the canonical Interaction directly rather than
// only StagedInteraction/Person (Track C, generalizing automation beyond the
// staging queue) — calls the shared packages/domain command instead of a
// raw Prisma write, per that command's own transactional GraphEvent publish.
registerAction({
  type: "interaction_set_field",
  authorityTier: "safe_auto",
  async execute(action, ctx) {
    if (ctx.targetType !== "interaction" || !ctx.targetId || !action.field) return null
    try {
      await setInteractionField({
        id: ctx.targetId,
        field: action.field,
        value: action.value,
        workspaceId: ctx.workspaceId,
        actor: ctx.actor,
      })
      return action
    } catch (error) {
      // Matches every other action here: "nothing to do" degrades to null
      // rather than throwing back into applyActions, which has no
      // try/catch around action execution — one bad/missing target must
      // not crash the whole rule run.
      if (error instanceof InteractionFieldError) return null
      throw error
    }
  },
})
