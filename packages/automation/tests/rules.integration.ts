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
  let testConfirmActionRan = false
  registerAction({
    type: "test_confirm_action",
    authorityTier: "confirm",
    async execute(action) {
      testConfirmActionRan = true
      return action
    },
  })

  const confirmRule = await createRule({
    name: "Needs confirmation",
    trigger: "inbox.stage",
    mode: "auto",
    conditions: [{ field: "source", operator: "equals", value: "needs-confirm" }],
    actions: [{ type: "test_confirm_action" }],
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
  assert.equal(testConfirmActionRan, false, "the confirm-tier action must not have executed yet")

  const pendingReview = await db.reviewItem.findMany({ where: { workspaceId, source: "rule", targetId: staged4.id } })
  assert.equal(pendingReview.length, 1, "a confirm-tier match must create exactly one ReviewItem")
  assert.equal(pendingReview[0].riskTier, "confirm")
  assert.equal(JSON.parse(pendingReview[0].proposedCommand).command, "automation.apply_action")
  assert.equal(pendingReview[0].sourceId, `${confirmRule.id}:stagedInteraction:${staged4.id}:test_confirm_action`, "sourceId must be deterministic per rule/target/action")

  // re-evaluating the same match must refresh the one item, not create a second
  await runRulesForTarget({
    trigger: "inbox.stage",
    payload: { source: "needs-confirm", stagedInteractionId: staged4.id },
    targetType: "stagedInteraction",
    targetId: staged4.id,
    actor: actor.actor,
    apply: true,
  })
  const stillOne = await db.reviewItem.count({ where: { workspaceId, source: "rule", targetId: staged4.id } })
  assert.equal(stillOne, 1, "re-matching the same rule/target/action must refresh, not duplicate, the pending ReviewItem")

  // accepting the ReviewItem is the human confirmation — the action actually runs now
  const resolved = await resolveReviewItem({ id: pendingReview[0].id, workspaceId, action: "accept", actor: actor.actor })
  assert.equal(resolved.status, "accepted")
  assert.equal(testConfirmActionRan, true, "accepting the ReviewItem must actually run the confirm-tier action")

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
