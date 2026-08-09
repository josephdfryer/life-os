import assert from "node:assert/strict"
import { db } from "@life-os/db"
import {
  createRule,
  updateRule,
  runRulesForTarget,
  listRuleRuns,
  applyRuleRunSuggestions,
  replayRule,
  testRule,
  registerAction,
  RuleError,
  MAX_CAUSATION_DEPTH,
} from "../index"
import { resolveReviewItem } from "@life-os/domain"

// Run against a real (throwaway, migrated) database — versioning, the
// causation-depth guard, and the safe_auto action executors (which touch
// StagedInteraction/Person rows) are exactly the parts a pure unit test
// can't exercise honestly. Not part of `tsx --test tests/*.test.ts`; run
// manually, same convention as the other packages/*/tests/*.integration.ts.

const workspaceId = "automation-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Automation integration", slug: workspaceId } })
  const user = await db.user.create({ data: { email: "automation-test@example.com" } })
  const actor = {
    userId: user.id,
    email: user.email,
    workspaceId,
    workspaceName: "Automation integration",
    actor: { type: "user" as const, id: user.id, workspaceId },
    scopes: ["*"],
  }
  const person = await db.person.create({ data: { workspaceId, first: "Rules", last: "Person", tags: JSON.stringify(["cold"]) } })

  // ── versioning: a real edit bumps Rule.version ──
  const rule = await createRule({
    name: "Tag known senders",
    trigger: "inbox.stage",
    mode: "auto",
    conditions: [{ field: "source", operator: "equals", value: "imessage" }],
    actions: [
      { type: "add_tag", value: "vip" },
      { type: "remove_tag", value: "cold" },
      { type: "set_field", field: "priority", value: 1 },
    ],
  }, actor)
  assert.equal(rule.version, 1)

  const updated = await updateRule(rule.id, { priority: 50 }, actor)
  assert.equal(updated.version, 2, "a real field edit must bump the version")

  const noOpUpdate = await updateRule(rule.id, {}, actor)
  assert.equal(noOpUpdate.version, 2, "an empty patch must not bump the version")

  // ── matched run: safe_auto actions actually apply, RuleRun denormalizes ruleVersion ──
  const staged = await db.stagedInteraction.create({
    data: {
      workspaceId, source: "imessage", sourceId: "auto-msg-1", status: "pending",
      itemType: "interaction", type: "message", timestamp: new Date(),
      summary: "hi", candidatePersonId: person.id, priority: 3,
    },
  })

  const result = await runRulesForTarget({
    trigger: "inbox.stage",
    payload: { source: "imessage", stagedInteractionId: staged.id },
    targetType: "stagedInteraction",
    targetId: staged.id,
    actor: actor.actor,
    apply: true,
  })
  assert.equal(result.matched, true)
  assert.equal(result.actionsApplied.length, 3, "add_tag + remove_tag + set_field must all apply")

  const stagedAfter = await db.stagedInteraction.findUniqueOrThrow({ where: { id: staged.id } })
  assert.equal(stagedAfter.priority, 1)

  const personAfter = await db.person.findUniqueOrThrow({ where: { id: person.id } })
  const tags = JSON.parse(personAfter.tags ?? "[]") as string[]
  assert.deepEqual(tags.sort(), ["vip"], "cold removed, vip added")

  const runs = await db.ruleRun.findMany({ where: { ruleId: rule.id, targetId: staged.id } })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].ruleVersion, 2, "RuleRun must denormalize the version active when it ran, not always 1")
  assert.equal(runs[0].status, "applied")

  // ── idempotent-ish re-apply: add_tag on an already-present tag is a no-op action, not an error ──
  const staged2 = await db.stagedInteraction.create({
    data: {
      workspaceId, source: "imessage", sourceId: "auto-msg-2", status: "pending",
      itemType: "interaction", type: "message", timestamp: new Date(),
      summary: "hi again", candidatePersonId: person.id,
    },
  })
  const result2 = await runRulesForTarget({
    trigger: "inbox.stage",
    payload: { source: "imessage", stagedInteractionId: staged2.id },
    targetType: "stagedInteraction",
    targetId: staged2.id,
    actor: actor.actor,
    apply: true,
  })
  // add_tag("vip") is now a no-op (already tagged); remove_tag("cold") is now a no-op (not present) — only set_field applies.
  assert.equal(result2.actionsApplied.length, 1)
  assert.equal(result2.actionsApplied[0].type, "set_field")

  // ── suggest mode: actions are planned but never applied without an explicit apply ──
  const suggestRule = await createRule({
    name: "Suggest a block",
    trigger: "inbox.stage",
    mode: "suggest",
    conditions: [{ field: "source", operator: "equals", value: "spam-source" }],
    actions: [{ type: "block" }],
  }, actor)
  const staged3 = await db.stagedInteraction.create({
    data: { workspaceId, source: "spam-source", sourceId: "spam-1", status: "pending", itemType: "interaction", type: "message", timestamp: new Date(), summary: "buy now" },
  })
  const result3 = await runRulesForTarget({
    trigger: "inbox.stage",
    payload: { source: "spam-source", stagedInteractionId: staged3.id },
    targetType: "stagedInteraction",
    targetId: staged3.id,
    actor: actor.actor,
    apply: true, // apply=true still must not auto-apply a "suggest" mode rule
  })
  assert.equal(result3.actionsApplied.length, 0, "suggest mode must never auto-apply regardless of apply flag")
  assert.equal(result3.actionsPlanned.length, 1)
  const staged3After = await db.stagedInteraction.findUniqueOrThrow({ where: { id: staged3.id } })
  assert.equal(staged3After.status, "pending", "a suggested block must not actually block")

  const suggestedRuns = await listRuleRuns({ ruleId: suggestRule.id }, workspaceId)
  assert.equal(suggestedRuns.runs[0].status, "suggested")

  // ── applying a suggestion later, through applyRuleRunSuggestions ──
  const applyResult = await applyRuleRunSuggestions([suggestedRuns.runs[0].id as string], staged3.id, actor.actor)
  assert.equal(applyResult.applied.length, 1)
  const staged3Blocked = await db.stagedInteraction.findUniqueOrThrow({ where: { id: staged3.id } })
  assert.equal(staged3Blocked.status, "blocked")

  // ── causation depth guard: a chain past MAX_CAUSATION_DEPTH halts instead of running ──
  const halted = await runRulesForTarget({
    trigger: "inbox.stage",
    payload: { source: "imessage" },
    causationDepth: MAX_CAUSATION_DEPTH + 1,
    apply: true,
  })
  assert.equal((halted as { haltedOnCausationDepth?: boolean }).haltedOnCausationDepth, true)
  assert.equal(halted.runCount, 0, "a halted chain must write no RuleRun rows")

  // ── replayRule: pure, writes nothing, not even a RuleRun ──
  const runCountBefore = await db.ruleRun.count({ where: { workspaceId } })
  const replay = replayRule(
    [{ field: "source", operator: "equals", value: "imessage" }],
    [{ type: "block" }],
    { source: "imessage" },
  )
  assert.equal(replay.matched, true)
  const runCountAfter = await db.ruleRun.count({ where: { workspaceId } })
  assert.equal(runCountAfter, runCountBefore, "replayRule must never write a RuleRun")

  // testRule (the audited dry-run) DOES write one, for the existing "test this rule" UI
  const dryRun = await testRule({ ruleId: rule.id, payload: { source: "imessage" } }, actor)
  assert.equal(dryRun.matched, true)
  assert.ok(dryRun.run, "testRule must record a dry_run RuleRun")

  // ── review-tier actions become a ReviewItem proposal, not a silent drop (Track C) ──
  // None of the built-in actions are review/confirm tier yet, so register a
  // throwaway test-only one to exercise the full pipeline end to end.
  const confirmedFields: string[] = []
  registerAction({
    type: "test_confirm_action",
    authorityTier: "confirm",
    async execute(action) {
      confirmedFields.push(action.field ?? "unknown")
      return action
    },
  })

  const confirmRule = await createRule({
    name: "Needs confirmation",
    trigger: "inbox.stage",
    mode: "auto",
    conditions: [{ field: "source", operator: "equals", value: "needs-confirm" }],
    actions: [
      { type: "test_confirm_action", field: "first" },
      { type: "test_confirm_action", field: "second" },
    ],
  }, actor)
  const staged4 = await db.stagedInteraction.create({
    data: { workspaceId, source: "needs-confirm", sourceId: "confirm-1", status: "pending", itemType: "interaction", type: "message", timestamp: new Date(), summary: "high stakes" },
  })
  const result4 = await runRulesForTarget({
    trigger: "inbox.stage",
    payload: { source: "needs-confirm", stagedInteractionId: staged4.id },
    targetType: "stagedInteraction",
    targetId: staged4.id,
    actor: actor.actor,
    apply: true, // even with apply=true, a confirm-tier action must never auto-run
  })
  assert.equal(result4.actionsApplied.length, 0, "a confirm-tier action must never appear in actionsApplied")
  assert.deepEqual(confirmedFields, [], "confirm-tier actions must not have executed yet")

  const pendingReview = await db.reviewItem.findMany({
    where: { workspaceId, source: "rule", targetId: staged4.id },
    orderBy: { sourceId: "asc" },
  })
  assert.equal(pendingReview.length, 2, "same-type confirm actions must remain separate ReviewItems")
  assert.equal(pendingReview[0].riskTier, "confirm")
  assert.equal(JSON.parse(pendingReview[0].proposedCommand).command, "automation.apply_action")
  assert.equal(pendingReview[0].sourceId, `${confirmRule.id}:v1:stagedInteraction:${staged4.id}:0:test_confirm_action`)
  assert.equal(pendingReview[1].sourceId, `${confirmRule.id}:v1:stagedInteraction:${staged4.id}:1:test_confirm_action`)

  // re-evaluating the same match must refresh the one item, not create a second
  await runRulesForTarget({
    trigger: "inbox.stage",
    payload: { source: "needs-confirm", stagedInteractionId: staged4.id },
    targetType: "stagedInteraction",
    targetId: staged4.id,
    actor: actor.actor,
    apply: true,
  })
  const stillTwo = await db.reviewItem.count({ where: { workspaceId, source: "rule", targetId: staged4.id } })
  assert.equal(stillTwo, 2, "re-matching the same rule definition must refresh, not duplicate, its proposals")

  // accepting each ReviewItem is the human confirmation — both actions run independently
  for (const item of pendingReview) {
    const resolved = await resolveReviewItem({ id: item.id, workspaceId, action: "accept", actor: actor.actor })
    assert.equal(resolved.status, "accepted")
  }
  assert.deepEqual(confirmedFields, ["first", "second"])

  // ── built-in Plan status action is review-tier and only runs on acceptance ──
  const plan = await db.plan.create({ data: { workspaceId, text: "A real commitment", status: "active" } })
  const planRule = await createRule({
    name: "Propose completing a plan",
    trigger: "plan.create",
    mode: "auto",
    actions: [{ type: "plan_set_status", value: "completed" }],
  }, actor)
  const planRun = await runRulesForTarget({
    trigger: "plan.create",
    payload: { planId: plan.id, text: plan.text, status: plan.status },
    targetType: "plan",
    targetId: plan.id,
    actor: actor.actor,
    apply: true,
  })
  assert.equal(planRun.actionsApplied.length, 0)
  assert.equal((await db.plan.findUniqueOrThrow({ where: { id: plan.id } })).status, "active")
  const planReview = await db.reviewItem.findFirstOrThrow({
    where: { workspaceId, source: "rule", targetType: "plan", targetId: plan.id },
  })
  assert.equal(planReview.riskTier, "review")
  assert.equal(planReview.sourceId, `${planRule.id}:v1:plan:${plan.id}:0:plan_set_status`)
  await resolveReviewItem({ id: planReview.id, workspaceId, action: "accept", actor: actor.actor })
  assert.equal((await db.plan.findUniqueOrThrow({ where: { id: plan.id } })).status, "completed")

  // ── Item enrichment action updates only a safe descriptive field ──
  const item = await db.item.create({ data: { workspaceId, name: "Jacket", assetId: "#AUTO-ITEM-1" } })
  await createRule({
    name: "Describe new items",
    trigger: "item.create",
    mode: "auto",
    actions: [{ type: "item_set_field", field: "notes", value: "Review care instructions" }],
  }, actor)
  const itemRun = await runRulesForTarget({
    trigger: "item.create",
    payload: { itemId: item.id, name: item.name, assetId: item.assetId },
    targetType: "item",
    targetId: item.id,
    actor: actor.actor,
    apply: true,
  })
  assert.equal(itemRun.actionsApplied.length, 1)
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).notes, "Review care instructions")

  const stateRule = await createRule({
    name: "Propose a condition for new items",
    trigger: "item.create",
    mode: "auto",
    actions: [{
      type: "state_record",
      field: "inventory_condition",
      value: { value: "needs_review", severity: 2, description: "Needs a manual inventory review" },
    }],
  }, actor)
  await runRulesForTarget({
    trigger: "item.create",
    payload: { itemId: item.id, name: item.name, assetId: item.assetId },
    targetType: "item",
    targetId: item.id,
    actor: actor.actor,
    apply: true,
  })
  assert.equal(await db.state.count({ where: { workspaceId, entityType: "Item", entityId: item.id } }), 0)
  const stateReview = await db.reviewItem.findFirstOrThrow({
    where: { workspaceId, source: "rule", sourceId: { startsWith: `${stateRule.id}:v1:item:${item.id}` } },
  })
  assert.equal(stateReview.riskTier, "review")
  await resolveReviewItem({ id: stateReview.id, workspaceId, action: "accept", actor: actor.actor })
  const itemState = await db.state.findFirstOrThrow({
    where: { workspaceId, entityType: "Item", entityId: item.id },
    include: { definition: true },
  })
  assert.equal(itemState.definition.type, "inventory_condition")
  assert.equal(itemState.definition.value, "needs_review")
  assert.equal(itemState.severity, 2)

  // ── error paths ──
  await assert.rejects(
    () => updateRule("does-not-exist", { priority: 1 }, actor),
    (error: unknown) => error instanceof RuleError && error.code === "not_found",
  )
  await assert.rejects(
    () => createRule({ trigger: "inbox.stage" }, actor), // missing required name
    (error: unknown) => error instanceof RuleError && error.code === "validation",
  )

  console.log("All automation integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
