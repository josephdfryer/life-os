import assert from "node:assert/strict"
import { db } from "@life-os/db"
import {
  createGroup, updateGroup, deleteGroup,
  addMember, removeMember,
  addPlaceAffiliation, removePlaceAffiliation,
  addSubgroup, GroupError,
} from "../groups"

// Run against a real (throwaway, migrated) database — the transactional
// GraphEvent publish is exactly the part a pure unit test cannot exercise
// honestly. Not part of `tsx --test tests/*.test.ts`; run manually, same
// convention as place-notes.integration.ts.

const workspaceId = "groups-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Groups integration", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "Integration", last: "Person" } })
  const place = await db.place.create({ data: { workspaceId, name: "HQ" } })

  // ── create: validates groupType, publishes a GraphEvent ──
  const group = await createGroup({ name: "Acme Corp", groupType: "employer" }, workspaceId, { type: "system" })
  assert.equal(group.name, "Acme Corp")
  const createEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Group", subjectId: group.id, eventType: "group.create" } })
  assert.equal(createEvents.length, 1)

  await assert.rejects(
    () => createGroup({ name: "Bad type", groupType: "not-a-real-type" }, workspaceId),
    (error: unknown) => error instanceof GroupError && error.code === "validation",
  )

  // ── update ──
  const updated = await updateGroup(group.id, { notes: "Main employer group" }, workspaceId)
  assert.equal(updated.notes, "Main employer group")
  await assert.rejects(
    () => updateGroup("does-not-exist", { notes: "x" }, workspaceId),
    (error: unknown) => error instanceof GroupError && error.code === "not_found",
  )

  // ── membership: add, publishes GraphEvent, duplicate-remove 404s appropriately ──
  const membership = await addMember(group.id, { personId: person.id }, workspaceId)
  assert.equal(membership.personId, person.id)
  const memberAddEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Group", subjectId: group.id, eventType: "group.member.add" } })
  assert.equal(memberAddEvents.length, 1)

  await assert.rejects(
    () => addMember(group.id, { personId: "does-not-exist" }, workspaceId),
    (error: unknown) => error instanceof GroupError && error.code === "not_found",
  )

  await removeMember(group.id, person.id, workspaceId)
  const active = await db.personGroup.findMany({ where: { groupId: group.id, personId: person.id, endDate: null } })
  assert.equal(active.length, 0, "removeMember must soft-remove (set endDate), not delete")
  await assert.rejects(
    () => removeMember(group.id, person.id, workspaceId),
    (error: unknown) => error instanceof GroupError && error.code === "not_found",
  )

  // ── place affiliation: add, validates relationshipType, remove ──
  const affiliation = await addPlaceAffiliation(group.id, { placeId: place.id, relationshipType: "employer_location" }, workspaceId)
  assert.equal(affiliation.placeId, place.id)
  await assert.rejects(
    () => addPlaceAffiliation(group.id, { placeId: place.id, relationshipType: "not-a-real-type" }, workspaceId),
    (error: unknown) => error instanceof GroupError && error.code === "validation",
  )
  await removePlaceAffiliation(group.id, place.id, workspaceId)
  assert.equal(await db.placeGroup.count({ where: { groupId: group.id, placeId: place.id } }), 0)
  await assert.rejects(
    () => removePlaceAffiliation(group.id, place.id, workspaceId),
    (error: unknown) => error instanceof GroupError && error.code === "not_found",
  )

  // ── subgroup: rejects self-nesting, links a real child ──
  const child = await createGroup({ name: "Acme Engineering", groupType: "employer" }, workspaceId)
  const link = await addSubgroup(group.id, { childGroupId: child.id }, workspaceId)
  assert.equal(link.childGroupId, child.id)
  await assert.rejects(
    () => addSubgroup(group.id, { childGroupId: group.id }, workspaceId),
    (error: unknown) => error instanceof GroupError && error.code === "validation",
  )

  // ── delete: a standalone group (child/group above are now linked by
  // GroupGroup, which has no cascade — deleting either would FK-violate,
  // pre-existing schema behavior unrelated to this extraction) ──
  const standalone = await createGroup({ name: "Standalone", groupType: "other" }, workspaceId)
  await deleteGroup(standalone.id, workspaceId)
  assert.equal(await db.group.findUnique({ where: { id: standalone.id } }), null)
  await assert.rejects(
    () => deleteGroup(standalone.id, workspaceId),
    (error: unknown) => error instanceof GroupError && error.code === "not_found",
  )

  console.log("All groups integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
