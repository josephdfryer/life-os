import test from "node:test"
import assert from "node:assert/strict"

// See docs/INBOX_TRIAGE_ANALYSIS.md. The queue reached 59 pending because every
// synced calendar Plan asked "did this happen?" and nothing ever answered
// automatically. These pin the three outcomes that keep it near zero.

const WS = "calendar-outcomes-test"

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

async function setup() {
  const { db } = await import("@life-os/db")
  await db.workspace.upsert({
    where: { id: WS },
    update: {},
    create: { id: WS, name: "Calendar Outcomes Test", slug: WS },
  })
  return db
}

async function makePlan(db: Awaited<ReturnType<typeof setup>>, start: Date) {
  const plan = await db.plan.create({
    data: {
      workspaceId: WS, text: "Tokyo plant review", externalSource: "google-calendar",
      scheduledStart: start, scheduledEnd: new Date(start.getTime() + 60 * 60 * 1000),
    },
  })
  await db.reviewItem.create({
    data: {
      workspaceId: WS, source: "calendar_reconciliation", sourceId: plan.id,
      itemType: "event", proposedCommand: JSON.stringify({ command: "calendar_reconciliation.reconcile", input: { planId: plan.id, action: "happened" } }),
      targetType: "Plan", targetId: plan.id, riskTier: "review", priority: 2,
    },
  })
  return plan
}

async function cleanup() {
  const { db } = await import("@life-os/db")
  await db.reviewItem.deleteMany({ where: { workspaceId: WS } })
  await db.interaction.deleteMany({ where: { workspaceId: WS } })
  await db.event.deleteMany({ where: { workspaceId: WS } })
  await db.plan.deleteMany({ where: { workspaceId: WS } })
}

test("corroborated events resolve themselves and close the queue entry", async () => {
  const db = await setup()
  const { matchCalendarOutcomes } = await import("../calendar-reconciliation-outcomes")
  try {
    const start = daysAgo(3)
    const plan = await makePlan(db, start)
    // Something happened in that window — here, money moved.
    await db.interaction.create({
      data: { workspaceId: WS, type: "financial", timestamp: new Date(start.getTime() + 30 * 60 * 1000), summary: "lunch", amount: 4_200 },
    })

    const results = await matchCalendarOutcomes(WS)
    assert.equal(results.find(r => r.planId === plan.id)?.outcome, "happened")

    // Resolving the Plan while leaving the question pending is the exact failure
    // that let the queue accumulate, so assert both sides moved.
    const item = await db.reviewItem.findFirst({ where: { workspaceId: WS, sourceId: plan.id } })
    assert.equal(item?.status, "accepted", "the review item must be closed, not just the Plan")
  } finally { await cleanup() }
})

test("stale unanswerable events are retired, never marked cancelled", async () => {
  const db = await setup()
  const { matchCalendarOutcomes } = await import("../calendar-reconciliation-outcomes")
  try {
    const plan = await makePlan(db, daysAgo(30))
    const results = await matchCalendarOutcomes(WS)
    assert.equal(results.find(r => r.planId === plan.id)?.outcome, "skipped")

    const after = await db.plan.findFirstOrThrow({ where: { id: plan.id } })
    assert.equal(after.reconciliationStatus, "skip")
    // Absence of evidence is not evidence of absence — the plan must not be
    // recorded as abandoned just because nothing corroborated it.
    assert.notEqual(after.status, "abandoned")

    const item = await db.reviewItem.findFirst({ where: { workspaceId: WS, sourceId: plan.id } })
    assert.equal(item?.status, "superseded", "retired items stop being offered")
  } finally { await cleanup() }
})

test("recent events with no evidence are left for a real decision", async () => {
  const db = await setup()
  const { matchCalendarOutcomes } = await import("../calendar-reconciliation-outcomes")
  try {
    const plan = await makePlan(db, daysAgo(2))
    const results = await matchCalendarOutcomes(WS)
    assert.equal(results.find(r => r.planId === plan.id), undefined, "still inside the answerable window")

    const item = await db.reviewItem.findFirst({ where: { workspaceId: WS, sourceId: plan.id } })
    assert.equal(item?.status, "pending")
  } finally { await cleanup() }
})

test("today's events are never evaluated", async () => {
  const db = await setup()
  const { matchCalendarOutcomes } = await import("../calendar-reconciliation-outcomes")
  try {
    const plan = await makePlan(db, new Date())
    const results = await matchCalendarOutcomes(WS)
    assert.equal(results.find(r => r.planId === plan.id), undefined, "there is no did-it-happen answer on the day itself")
  } finally { await cleanup() }
})
