import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import { createTestDatabase, type TestDatabase } from "@life-os/db/testing"

let testDb: TestDatabase
before(async () => { testDb = await createTestDatabase() })
after(async () => { await testDb?.drop() })

// See docs/ORGANIZATION_AGGREGATE_STRATEGY.md. The two properties worth pinning
// are the ones the design exists for: history stays with the organization after
// a person leaves, and re-attribution is never silent.

const WS = "org-aggregate-test"

async function seed() {
  const { db } = await import("@life-os/db")
  await db.workspace.upsert({
    where: { id: WS },
    update: {},
    create: { id: WS, name: "Org Aggregate Test", slug: WS },
  })
  const group = await db.group.create({ data: { workspaceId: WS, name: "Estée Lauder", groupType: "corporation" } })
  const person = await db.person.create({ data: { workspaceId: WS, first: "Aiko", last: "Tanaka" } })
  return { db, group, person }
}

test("interactions stay with the organization after the person moves on", async () => {
  const { db, group, person } = await seed()
  const { getOrganizationDossier } = await import("../organizations")
  try {
    // A meeting while they worked there, then the membership ends.
    await db.interaction.create({
      data: { workspaceId: WS, personId: person.id, groupId: group.id, type: "meeting", timestamp: new Date("2022-06-01"), summary: "Tokyo plant tour" },
    })
    await db.personGroup.create({
      data: { personId: person.id, groupId: group.id, role: "Ops lead", startDate: new Date("2021-01-01"), endDate: new Date("2024-03-01") },
    })

    const dossier = await getOrganizationDossier(group.id, WS)
    assert.ok(dossier)
    // The attribution is on the row, so ending the membership cannot remove it.
    assert.equal(dossier.interactions.total, 1, "the meeting must remain part of the company history")
    const aiko = dossier.people.find(p => p.personId === person.id)
    assert.ok(aiko, "a former colleague is still listed")
    assert.equal(aiko.current, false, "but is marked as former, not current")
  } finally {
    await db.interaction.deleteMany({ where: { workspaceId: WS } })
    await db.personGroup.deleteMany({ where: { groupId: group.id } })
  }
})

test("spend and meetings aggregate over the same rows", async () => {
  const { db, group } = await seed()
  const { getOrganizationDossier } = await import("../organizations")
  try {
    await db.interaction.createMany({
      data: [
        { workspaceId: WS, groupId: group.id, type: "financial", timestamp: new Date("2023-02-01"), summary: "ESTEE LAUDER ONLINE", amount: 12_050 },
        { workspaceId: WS, groupId: group.id, type: "financial", timestamp: new Date("2023-03-01"), summary: "ESTEE LAUDER #4471", amount: 7_900 },
        { workspaceId: WS, groupId: group.id, type: "email", timestamp: new Date("2023-04-01"), summary: "Q2 brief" },
      ],
    })
    const dossier = await getOrganizationDossier(group.id, WS)
    assert.ok(dossier)
    assert.equal(dossier.interactions.total, 3, "one filter covers spend and contact together")
    assert.equal(dossier.spend.count, 2)
    assert.equal(dossier.spend.total, 19_950, "amounts are minor units and sum without a second system")
  } finally {
    await db.interaction.deleteMany({ where: { workspaceId: WS } })
  }
})

test("re-attribution is recorded, not silent", async () => {
  const { db, group } = await seed()
  const { setInteractionGroup } = await import("../organizations")
  const wrong = await db.group.create({ data: { workspaceId: WS, name: "Sephora", groupType: "corporation" } })
  const interaction = await db.interaction.create({
    data: { workspaceId: WS, groupId: wrong.id, type: "financial", timestamp: new Date("2023-05-01"), summary: "misattributed", amount: 100 },
  })
  try {
    const result = await setInteractionGroup(interaction.id, group.id, WS, { type: "assistant", label: "test" })
    assert.equal(result.changed, true)
    assert.equal(result.from, wrong.id)

    const events = await db.graphEvent.findMany({
      where: { workspaceId: WS, subjectType: "Interaction", subjectId: interaction.id },
    })
    const reattribution = events.find(e => e.eventType === "interaction.reattributed")
    assert.ok(reattribution, "correcting an attribution must leave a trace")
    const payload = JSON.parse(String(reattribution.payload))
    assert.equal(payload.from, wrong.id, "the event records what it used to be")
    assert.equal(payload.to, group.id)

    // Re-applying the same value is a no-op and must not add noise to history.
    const again = await setInteractionGroup(interaction.id, group.id, WS)
    assert.equal(again.changed, false)
  } finally {
    await db.graphEvent.deleteMany({ where: { workspaceId: WS } })
    await db.interaction.deleteMany({ where: { workspaceId: WS } })
    await db.group.deleteMany({ where: { workspaceId: WS } })
  }
})

test("merchant blast radius separates new attributions from re-attributions", async () => {
  const { db, group } = await seed()
  const { merchantAttributionBlastRadius } = await import("../organization-review")
  try {
    await db.interaction.createMany({
      data: [
        { workspaceId: WS, type: "financial", timestamp: new Date("2023-01-01"), summary: "ESTEE LAUDER #1", amount: 1_000 },
        { workspaceId: WS, type: "financial", timestamp: new Date("2023-01-02"), summary: "ESTEE LAUDER #2", amount: 2_000 },
        { workspaceId: WS, groupId: group.id, type: "financial", timestamp: new Date("2023-01-03"), summary: "ESTEE LAUDER #3", amount: 3_000 },
      ],
    })
    const radius = await merchantAttributionBlastRadius("ESTEE LAUDER", WS)
    assert.equal(radius.interactions, 3, "shows the full reach before a rule is created")
    assert.equal(radius.totalAmount, 6_000)
    assert.equal(radius.alreadyAttributed, 1, "the riskier half — rows this would overwrite — is surfaced separately")
  } finally {
    await db.interaction.deleteMany({ where: { workspaceId: WS } })
  }
})
