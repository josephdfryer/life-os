import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { createPerson, updatePerson, deletePerson, setPersonTags, getPersonTags, PersonError } from "../persons"

// Run against a real (throwaway, migrated) database — the transactional
// GraphEvent publish and the birthday/color assignment logic are exactly
// the parts a pure unit test cannot exercise honestly. Not part of
// `tsx --test tests/*.test.ts`; run manually, same convention as
// interactions.integration.ts.

const workspaceId = "persons-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Persons integration", slug: workspaceId } })

  // ── create: validates, assigns a color, publishes a GraphEvent ──
  const created = await createPerson({ first: "Ada", last: "Lovelace", birthday: "12-10", tags: ["mathematician"] }, workspaceId, { type: "system" })
  assert.equal(created.first, "Ada")
  assert.equal(created.last, "Lovelace")
  assert.equal(created.birthday, "--12-10")
  assert.equal(created.closeness, 1, "new People default to the lowest closeness")
  assert.ok(created.color, "a color must be assigned")
  assert.deepEqual(JSON.parse(created.tags), ["mathematician"])

  const createEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Person", subjectId: created.id, eventType: "person.create" } })
  assert.equal(createEvents.length, 1)

  // ── create: a missing first name is rejected, not silently defaulted ──
  await assert.rejects(
    () => createPerson({ last: "NoFirstName" }, workspaceId),
    (error: unknown) => error instanceof PersonError && error.code === "validation",
  )

  // ── create: an invalid birthday is rejected ──
  await assert.rejects(
    () => createPerson({ first: "Bad", birthday: "not-a-date" }, workspaceId),
    (error: unknown) => error instanceof PersonError && error.code === "validation",
  )

  // ── update: patches only the given fields, publishes a GraphEvent ──
  const updated = await updatePerson(created.id, { headline: "Computer science pioneer" }, workspaceId)
  assert.equal(updated.headline, "Computer science pioneer")
  assert.equal(updated.first, "Ada", "unspecified fields must be untouched")

  const updateEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Person", subjectId: created.id, eventType: "person.update" } })
  assert.equal(updateEvents.length, 1)
  assert.deepEqual(JSON.parse(updateEvents[0].payload).fields, ["headline"])

  // ── update: a not-found id 404s ──
  await assert.rejects(
    () => updatePerson("does-not-exist", { headline: "x" }, workspaceId),
    (error: unknown) => error instanceof PersonError && error.code === "not_found",
  )

  // ── setPersonTags / getPersonTags: full replace, not merge ──
  const tagged = await setPersonTags(created.id, ["mathematician", "programmer"], workspaceId)
  assert.deepEqual(JSON.parse(tagged.tags), ["mathematician", "programmer"])
  const tags = await getPersonTags(created.id, workspaceId)
  assert.deepEqual(tags, ["mathematician", "programmer"])
  assert.equal(await getPersonTags("does-not-exist", workspaceId), null)

  // ── delete: removes the row, publishes a GraphEvent, then 404s on retry ──
  await deletePerson(created.id, workspaceId)
  assert.equal(await db.person.findUnique({ where: { id: created.id } }), null)
  const deleteEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Person", subjectId: created.id, eventType: "person.delete" } })
  assert.equal(deleteEvents.length, 1)
  await assert.rejects(
    () => deletePerson(created.id, workspaceId),
    (error: unknown) => error instanceof PersonError && error.code === "not_found",
  )

  // ── cross-workspace isolation: a real person, wrong workspace, 404s ──
  const otherWorkspaceId = "persons-integration-other-workspace"
  await db.workspace.create({ data: { id: otherWorkspaceId, name: "Other", slug: otherWorkspaceId } })
  const isolated = await createPerson({ first: "Isolated" }, otherWorkspaceId)
  await assert.rejects(
    () => updatePerson(isolated.id, { first: "Hijacked" }, workspaceId),
    (error: unknown) => error instanceof PersonError && error.code === "not_found",
  )

  console.log("All persons integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
