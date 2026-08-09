import { publishGraphEvent, type GraphEventActor } from "./events"
import { writeAuditLog, type AuditActor } from "./audit"

// Extracted from apps/persons/server/domain/groups.ts's write operations
// (Track C, phase C4). Reads (getGroup, listGroups, listMembers,
// sumInteractionsByPlace/Group/GroupType, getGroupEvents and the group-
// event-inference logic) stay exactly where they were — dashboard/rollup
// computation, not domain writes, same reasoning as places.ts.

export const GROUP_TYPES = [
  "family",
  "employer",
  "friend_group",
  "sports_team",
  "corporation",
  "community",
  "other",
] as const

export const PLACE_GROUP_RELATIONSHIP_TYPES = [
  "corporate_parent",
  "employer_location",
  "home_venue",
  "residence",
  "usual_spot",
  "other",
] as const

export type GroupType = (typeof GROUP_TYPES)[number]
export type PlaceGroupRelationshipType = (typeof PLACE_GROUP_RELATIONSHIP_TYPES)[number]

export class GroupError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "GroupError"
  }
}

function validGroupType(value: unknown): GroupType {
  if (!GROUP_TYPES.includes(value as GroupType)) {
    throw new GroupError(`groupType must be one of: ${GROUP_TYPES.join(", ")}`, "validation")
  }
  return value as GroupType
}

function validPlaceGroupRelationshipType(value: unknown): PlaceGroupRelationshipType {
  if (!PLACE_GROUP_RELATIONSHIP_TYPES.includes(value as PlaceGroupRelationshipType)) {
    throw new GroupError(`relationshipType must be one of: ${PLACE_GROUP_RELATIONSHIP_TYPES.join(", ")}`, "validation")
  }
  return value as PlaceGroupRelationshipType
}

function optionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) throw new GroupError("Invalid date", "validation")
  return d
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new GroupError(`${field} is required`, "validation")
  return value.trim()
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null
}

type Actor = GraphEventActor & AuditActor

export async function createGroup(input: Record<string, unknown>, workspaceId = "default-workspace", actor?: Actor) {
  const { db } = await import("@life-os/db")
  const name = requiredString(input.name, "name")
  const groupType = validGroupType(input.groupType)

  const group = await db.$transaction(async tx => {
    const created = await tx.group.create({
      data: { workspaceId, name, groupType, notes: optionalString(input.notes) ?? undefined },
    })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Group",
      subjectId: created.id,
      eventType: "group.create",
      actor,
      idempotencyKey: `group-create:${created.id}`,
      payload: { name: created.name, groupType: created.groupType },
    })
    return created
  })

  await writeAuditLog({ actor, action: "group.create", targetType: "group", targetId: group.id })
  return group
}

export async function updateGroup(id: string, input: Record<string, unknown>, workspaceId = "default-workspace", actor?: Actor) {
  const { db } = await import("@life-os/db")
  const existing = await db.group.findFirst({ where: { id, workspaceId } })
  if (!existing) throw new GroupError("Group not found", "not_found")

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = requiredString(input.name, "name")
  if (input.groupType !== undefined) patch.groupType = validGroupType(input.groupType)
  if (input.notes !== undefined) patch.notes = optionalString(input.notes) ?? undefined

  const group = await db.$transaction(async tx => {
    const updated = await tx.group.update({ where: { id }, data: patch })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Group",
      subjectId: id,
      eventType: "group.update",
      actor,
      idempotencyKey: `group-update:${id}:${Date.now()}`,
      payload: { fields: Object.keys(patch) },
    })
    return updated
  })

  await writeAuditLog({ actor, action: "group.update", targetType: "group", targetId: id, metadata: { fields: Object.keys(patch) } })
  return group
}

export async function deleteGroup(id: string, workspaceId = "default-workspace", actor?: Actor) {
  const { db } = await import("@life-os/db")
  const existing = await db.group.findFirst({ where: { id, workspaceId } })
  if (!existing) throw new GroupError("Group not found", "not_found")

  await db.$transaction(async tx => {
    await tx.group.delete({ where: { id } })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Group",
      subjectId: id,
      eventType: "group.delete",
      actor,
      idempotencyKey: `group-delete:${id}`,
      payload: {},
    })
  })

  await writeAuditLog({ actor, action: "group.delete", targetType: "group", targetId: id })
}

export async function addMember(groupId: string, input: Record<string, unknown>, workspaceId = "default-workspace", actor?: Actor) {
  const { db } = await import("@life-os/db")
  const group = await db.group.findFirst({ where: { id: groupId, workspaceId } })
  if (!group) throw new GroupError("Group not found", "not_found")

  const personId = requiredString(input.personId, "personId")
  const person = await db.person.findFirst({ where: { id: personId, workspaceId } })
  if (!person) throw new GroupError("Person not found", "not_found")

  const membership = await db.$transaction(async tx => {
    const created = await tx.personGroup.create({
      data: {
        personId,
        groupId,
        role: optionalString(input.role) ?? undefined,
        startDate: optionalDate(input.startDate) ?? undefined,
        endDate: optionalDate(input.endDate) ?? undefined,
      },
      include: { person: { select: { id: true, first: true, last: true } } },
    })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Group",
      subjectId: groupId,
      eventType: "group.member.add",
      actor,
      idempotencyKey: `group-member-add:${created.id}`,
      payload: { personId },
    })
    return created
  })

  await writeAuditLog({ actor, action: "group.member.add", targetType: "group", targetId: groupId, metadata: { personId } })
  return membership
}

export async function removeMember(groupId: string, personId: string, workspaceId = "default-workspace", actor?: Actor) {
  const { db } = await import("@life-os/db")
  const group = await db.group.findFirst({ where: { id: groupId, workspaceId } })
  if (!group) throw new GroupError("Group not found", "not_found")

  // Soft-remove: set endDate to now on all active memberships for this person in this group
  const active = await db.personGroup.findMany({
    where: { groupId, personId, OR: [{ endDate: null }, { endDate: { gt: new Date() } }] },
  })
  if (!active.length) throw new GroupError("Active membership not found", "not_found")

  await db.$transaction(async tx => {
    await tx.personGroup.updateMany({ where: { id: { in: active.map(m => m.id) } }, data: { endDate: new Date() } })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Group",
      subjectId: groupId,
      eventType: "group.member.remove",
      actor,
      idempotencyKey: `group-member-remove:${groupId}:${personId}:${Date.now()}`,
      payload: { personId },
    })
  })

  await writeAuditLog({ actor, action: "group.member.remove", targetType: "group", targetId: groupId, metadata: { personId } })
}

export async function addPlaceAffiliation(groupId: string, input: Record<string, unknown>, workspaceId = "default-workspace", actor?: Actor) {
  const { db } = await import("@life-os/db")
  const group = await db.group.findFirst({ where: { id: groupId, workspaceId } })
  if (!group) throw new GroupError("Group not found", "not_found")

  const placeId = requiredString(input.placeId, "placeId")
  const place = await db.place.findFirst({ where: { id: placeId, workspaceId } })
  if (!place) throw new GroupError("Place not found", "not_found")
  const relationshipType = validPlaceGroupRelationshipType(input.relationshipType)

  const affiliation = await db.$transaction(async tx => {
    const created = await tx.placeGroup.create({
      data: {
        placeId,
        groupId,
        relationshipType,
        startDate: optionalDate(input.startDate) ?? undefined,
        endDate: optionalDate(input.endDate) ?? undefined,
      },
      include: { place: { select: { id: true, name: true, type: true } } },
    })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Group",
      subjectId: groupId,
      eventType: "group.place.add",
      actor,
      idempotencyKey: `group-place-add:${created.id}`,
      payload: { placeId },
    })
    return created
  })

  await writeAuditLog({ actor, action: "group.place.add", targetType: "group", targetId: groupId, metadata: { placeId } })
  return affiliation
}

export async function removePlaceAffiliation(groupId: string, placeId: string, workspaceId = "default-workspace", actor?: Actor) {
  const { db } = await import("@life-os/db")
  const group = await db.group.findFirst({ where: { id: groupId, workspaceId } })
  if (!group) throw new GroupError("Group not found", "not_found")

  const affiliations = await db.placeGroup.findMany({ where: { groupId, placeId } })
  if (!affiliations.length) throw new GroupError("Place affiliation not found", "not_found")

  await db.$transaction(async tx => {
    await tx.placeGroup.deleteMany({ where: { id: { in: affiliations.map(a => a.id) } } })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Group",
      subjectId: groupId,
      eventType: "group.place.remove",
      actor,
      idempotencyKey: `group-place-remove:${groupId}:${placeId}:${Date.now()}`,
      payload: { placeId },
    })
  })

  await writeAuditLog({ actor, action: "group.place.remove", targetType: "group", targetId: groupId, metadata: { placeId } })
}

export async function addSubgroup(parentGroupId: string, input: Record<string, unknown>, workspaceId = "default-workspace", actor?: Actor) {
  const { db } = await import("@life-os/db")
  const parent = await db.group.findFirst({ where: { id: parentGroupId, workspaceId } })
  if (!parent) throw new GroupError("Parent group not found", "not_found")

  const childGroupId = requiredString(input.childGroupId, "childGroupId")
  if (childGroupId === parentGroupId) throw new GroupError("A group cannot be a subgroup of itself", "validation")

  const child = await db.group.findFirst({ where: { id: childGroupId, workspaceId } })
  if (!child) throw new GroupError("Child group not found", "not_found")

  const link = await db.$transaction(async tx => {
    const created = await tx.groupGroup.create({
      data: {
        parentGroupId,
        childGroupId,
        role: optionalString(input.role) ?? undefined,
        startDate: optionalDate(input.startDate) ?? undefined,
        endDate: optionalDate(input.endDate) ?? undefined,
      },
    })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Group",
      subjectId: parentGroupId,
      eventType: "group.subgroup.add",
      actor,
      idempotencyKey: `group-subgroup-add:${created.id}`,
      payload: { childGroupId },
    })
    return created
  })

  await writeAuditLog({ actor, action: "group.subgroup.add", targetType: "group", targetId: parentGroupId, metadata: { childGroupId } })
  return link
}
