import { db } from "@/lib/db"
import { centsToDollars } from "@life-os/db"
import { badRequest, notFound } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"

// ─── Types ────────────────────────────────────────────────────────────────────

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

function validGroupType(value: unknown): GroupType {
  if (!GROUP_TYPES.includes(value as GroupType)) {
    throw badRequest(`groupType must be one of: ${GROUP_TYPES.join(", ")}`, { field: "groupType" })
  }
  return value as GroupType
}

function validPlaceGroupRelationshipType(value: unknown): PlaceGroupRelationshipType {
  if (!PLACE_GROUP_RELATIONSHIP_TYPES.includes(value as PlaceGroupRelationshipType)) {
    throw badRequest(
      `relationshipType must be one of: ${PLACE_GROUP_RELATIONSHIP_TYPES.join(", ")}`,
      { field: "relationshipType" },
    )
  }
  return value as PlaceGroupRelationshipType
}

function optionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) throw badRequest("Invalid date", { value })
  return d
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} is required`, { field })
  }
  return value.trim()
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createGroup(
  input: Record<string, unknown>,
  actor: DomainActor,
) {
  const workspaceId = actor.workspaceId ?? "default-workspace"
  const group = await db.group.create({
    data: {
      workspaceId,
      name: requiredString(input.name, "name"),
      groupType: validGroupType(input.groupType),
      notes: optionalString(input.notes) ?? undefined,
    },
  })
  await auditAction({ actor, action: "group.create", targetType: "group", targetId: group.id })
  return group
}

export async function updateGroup(
  id: string,
  input: Record<string, unknown>,
  actor: DomainActor,
) {
  const workspaceId = actor.workspaceId ?? "default-workspace"
  const existing = await db.group.findFirst({ where: { id, workspaceId } })
  if (!existing) throw notFound("Group not found", { id })

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = requiredString(input.name, "name")
  if (input.groupType !== undefined) patch.groupType = validGroupType(input.groupType)
  if (input.notes !== undefined) patch.notes = optionalString(input.notes) ?? undefined

  const group = await db.group.update({ where: { id }, data: patch })
  await auditAction({ actor, action: "group.update", targetType: "group", targetId: id, metadata: { fields: Object.keys(patch) } })
  return group
}

export async function deleteGroup(id: string, actor: DomainActor) {
  const workspaceId = actor.workspaceId ?? "default-workspace"
  const existing = await db.group.findFirst({ where: { id, workspaceId } })
  if (!existing) throw notFound("Group not found", { id })
  await db.group.delete({ where: { id } })
  await auditAction({ actor, action: "group.delete", targetType: "group", targetId: id })
}

export async function getGroup(id: string, workspaceId: string | null | undefined) {
  const wsId = workspaceId ?? "default-workspace"
  const group = await db.group.findFirst({
    where: { id, workspaceId: wsId },
    include: {
      personMembers: {
        where: { OR: [{ endDate: null }, { endDate: { gt: new Date() } }] },
        include: { person: { select: { id: true, first: true, last: true, title: true } } },
        orderBy: { startDate: "asc" },
      },
      placeAffiliations: {
        include: { place: { select: { id: true, name: true, type: true, address: true } } },
        orderBy: { startDate: "asc" },
      },
      taggedEvents: {
        where: { timestamp: { lte: new Date() } },
        orderBy: { timestamp: "desc" },
        take: 20,
        select: { id: true, name: true, type: true, timestamp: true, placeId: true },
      },
      childGroups: {
        include: { child: { select: { id: true, name: true, groupType: true } } },
      },
      parentGroups: {
        include: { parent: { select: { id: true, name: true, groupType: true } } },
      },
    },
  })
  return group
}

export async function listGroups(
  workspaceId: string | null | undefined,
  opts: { groupType?: string; search?: string; page?: number; limit?: number },
) {
  const wsId = workspaceId ?? "default-workspace"
  const page = Math.max(0, opts.page ?? 0)
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50))

  const AND: Record<string, unknown>[] = [{ workspaceId: wsId }]
  if (opts.groupType && GROUP_TYPES.includes(opts.groupType as GroupType)) {
    AND.push({ groupType: opts.groupType })
  }
  if (opts.search?.trim()) {
    AND.push({ name: { contains: opts.search.trim() } })
  }

  const where = AND.length === 1 ? { workspaceId: wsId } : { AND }
  const [groups, total] = await Promise.all([
    db.group.findMany({
      where,
      include: { _count: { select: { personMembers: true, placeAffiliations: true } } },
      orderBy: { name: "asc" },
      skip: page * limit,
      take: limit,
    }),
    db.group.count({ where }),
  ])

  return { groups, total, page, limit, hasMore: (page + 1) * limit < total }
}

// ─── Membership ───────────────────────────────────────────────────────────────

export async function addMember(
  groupId: string,
  input: Record<string, unknown>,
  actor: DomainActor,
) {
  const wsId = actor.workspaceId ?? "default-workspace"
  const group = await db.group.findFirst({ where: { id: groupId, workspaceId: wsId } })
  if (!group) throw notFound("Group not found", { groupId })

  const personId = requiredString(input.personId, "personId")
  const person = await db.person.findFirst({ where: { id: personId, workspaceId: wsId } })
  if (!person) throw notFound("Person not found", { personId })

  const membership = await db.personGroup.create({
    data: {
      personId,
      groupId,
      role: optionalString(input.role) ?? undefined,
      startDate: optionalDate(input.startDate) ?? undefined,
      endDate: optionalDate(input.endDate) ?? undefined,
    },
    include: { person: { select: { id: true, first: true, last: true } } },
  })

  await auditAction({ actor, action: "group.member.add", targetType: "group", targetId: groupId, metadata: { personId } })
  return membership
}

export async function removeMember(groupId: string, personId: string, actor: DomainActor) {
  const wsId = actor.workspaceId ?? "default-workspace"
  const group = await db.group.findFirst({ where: { id: groupId, workspaceId: wsId } })
  if (!group) throw notFound("Group not found", { groupId })

  // Soft-remove: set endDate to now on all active memberships for this person in this group
  const active = await db.personGroup.findMany({
    where: { groupId, personId, OR: [{ endDate: null }, { endDate: { gt: new Date() } }] },
  })
  if (!active.length) throw notFound("Active membership not found", { groupId, personId })

  await db.personGroup.updateMany({
    where: { id: { in: active.map(m => m.id) } },
    data: { endDate: new Date() },
  })

  await auditAction({ actor, action: "group.member.remove", targetType: "group", targetId: groupId, metadata: { personId } })
}

export async function listMembers(groupId: string, workspaceId: string | null | undefined, asOf?: Date) {
  const wsId = workspaceId ?? "default-workspace"
  const group = await db.group.findFirst({ where: { id: groupId, workspaceId: wsId } })
  if (!group) throw notFound("Group not found", { groupId })

  const cutoff = asOf ?? new Date()
  return db.personGroup.findMany({
    where: {
      groupId,
      startDate: { lte: cutoff },
      OR: [{ endDate: null }, { endDate: { gt: cutoff } }],
    },
    include: { person: { select: { id: true, first: true, last: true, title: true, emails: true } } },
    orderBy: { startDate: "asc" },
  })
}

// ─── Place affiliation ────────────────────────────────────────────────────────

export async function addPlaceAffiliation(
  groupId: string,
  input: Record<string, unknown>,
  actor: DomainActor,
) {
  const wsId = actor.workspaceId ?? "default-workspace"
  const group = await db.group.findFirst({ where: { id: groupId, workspaceId: wsId } })
  if (!group) throw notFound("Group not found", { groupId })

  const placeId = requiredString(input.placeId, "placeId")
  const place = await db.place.findFirst({ where: { id: placeId, workspaceId: wsId } })
  if (!place) throw notFound("Place not found", { placeId })

  const affiliation = await db.placeGroup.create({
    data: {
      placeId,
      groupId,
      relationshipType: validPlaceGroupRelationshipType(input.relationshipType),
      startDate: optionalDate(input.startDate) ?? undefined,
      endDate: optionalDate(input.endDate) ?? undefined,
    },
    include: { place: { select: { id: true, name: true, type: true } } },
  })

  await auditAction({ actor, action: "group.place.add", targetType: "group", targetId: groupId, metadata: { placeId } })
  return affiliation
}

export async function removePlaceAffiliation(groupId: string, placeId: string, actor: DomainActor) {
  const wsId = actor.workspaceId ?? "default-workspace"
  const group = await db.group.findFirst({ where: { id: groupId, workspaceId: wsId } })
  if (!group) throw notFound("Group not found", { groupId })

  const affiliations = await db.placeGroup.findMany({ where: { groupId, placeId } })
  if (!affiliations.length) throw notFound("Place affiliation not found", { groupId, placeId })

  await db.placeGroup.deleteMany({ where: { id: { in: affiliations.map(a => a.id) } } })
  await auditAction({ actor, action: "group.place.remove", targetType: "group", targetId: groupId, metadata: { placeId } })
}

// ─── Group nesting ────────────────────────────────────────────────────────────

export async function addSubgroup(
  parentGroupId: string,
  input: Record<string, unknown>,
  actor: DomainActor,
) {
  const wsId = actor.workspaceId ?? "default-workspace"
  const parent = await db.group.findFirst({ where: { id: parentGroupId, workspaceId: wsId } })
  if (!parent) throw notFound("Parent group not found", { parentGroupId })

  const childGroupId = requiredString(input.childGroupId, "childGroupId")
  if (childGroupId === parentGroupId) throw badRequest("A group cannot be a subgroup of itself")

  const child = await db.group.findFirst({ where: { id: childGroupId, workspaceId: wsId } })
  if (!child) throw notFound("Child group not found", { childGroupId })

  const link = await db.groupGroup.create({
    data: {
      parentGroupId,
      childGroupId,
      role: optionalString(input.role) ?? undefined,
      startDate: optionalDate(input.startDate) ?? undefined,
      endDate: optionalDate(input.endDate) ?? undefined,
    },
  })

  await auditAction({ actor, action: "group.subgroup.add", targetType: "group", targetId: parentGroupId, metadata: { childGroupId } })
  return link
}

// ─── Query: active members at a point in time ─────────────────────────────────

export async function getActiveMembers(groupId: string, workspaceId: string | null | undefined, asOf?: Date) {
  return listMembers(groupId, workspaceId, asOf)
}

// ─── Query: financial rollups ─────────────────────────────────────────────────

export async function sumInteractionsByPlace(
  placeId: string,
  workspaceId: string | null | undefined,
  dateRange?: { from?: Date; to?: Date },
) {
  const wsId = workspaceId ?? "default-workspace"
  const where: Record<string, unknown> = { workspaceId: wsId, placeId, amount: { not: null } }
  if (dateRange?.from || dateRange?.to) {
    where.timestamp = {
      ...(dateRange.from ? { gte: dateRange.from } : {}),
      ...(dateRange.to ? { lte: dateRange.to } : {}),
    }
  }

  // Aggregated in SQL rather than reduced over a fetched row set — the sum
  // and count are all this needs, and computing them in the database means
  // this never has to transfer (or hold in memory) every matching
  // Interaction just to add up one column.
  const result = await db.interaction.aggregate({
    where,
    _sum: { amount: true },
    _count: true,
  })

  return {
    placeId,
    total: centsToDollars(result._sum.amount ?? 0) ?? 0,
    count: result._count,
  }
}

export async function sumInteractionsByGroup(
  groupId: string,
  workspaceId: string | null | undefined,
  dateRange?: { from?: Date; to?: Date },
) {
  const wsId = workspaceId ?? "default-workspace"
  // Find all places affiliated with this group
  const affiliations = await db.placeGroup.findMany({
    where: { groupId },
    select: { placeId: true },
  })
  const placeIds = affiliations.map(a => a.placeId)
  if (!placeIds.length) return { groupId, total: 0, count: 0, placeIds: [] }

  // Find all events at those places
  const events = await db.event.findMany({
    where: { workspaceId: wsId, placeId: { in: placeIds } },
    select: { id: true },
  })
  const eventIds = events.map(e => e.id)
  if (!eventIds.length) return { groupId, total: 0, count: 0, placeIds }

  // Sum interactions on those events
  const where: Record<string, unknown> = {
    workspaceId: wsId,
    eventId: { in: eventIds },
    amount: { not: null },
  }
  if (dateRange?.from || dateRange?.to) {
    where.timestamp = {
      ...(dateRange.from ? { gte: dateRange.from } : {}),
      ...(dateRange.to ? { lte: dateRange.to } : {}),
    }
  }

  const result = await db.interaction.aggregate({
    where,
    _sum: { amount: true },
    _count: true,
  })
  return {
    groupId,
    total: centsToDollars(result._sum.amount ?? 0) ?? 0,
    count: result._count,
    placeIds,
  }
}

export async function sumInteractionsByGroupType(
  groupType: GroupType,
  workspaceId: string | null | undefined,
  dateRange?: { from?: Date; to?: Date },
) {
  const wsId = workspaceId ?? "default-workspace"
  // Find all groups of this type in the workspace
  const groups = await db.group.findMany({
    where: { workspaceId: wsId, groupType },
    select: { id: true },
  })

  const results = await Promise.all(
    groups.map(g => sumInteractionsByGroup(g.id, workspaceId, dateRange))
  )

  return {
    groupType,
    total: results.reduce((sum, r) => sum + r.total, 0),
    count: results.reduce((sum, r) => sum + r.count, 0),
    byGroup: results,
  }
}

// ─── Query: group events (inferred + explicit) ────────────────────────────────

export type GroupEventSource = "membership" | "explicit" | "both"

export async function getGroupEvents(
  groupId: string,
  workspaceId: string | null | undefined,
  dateRange?: { from?: Date; to?: Date },
) {
  const wsId = workspaceId ?? "default-workspace"
  // Active members right now (use start of dateRange.to as reference if provided)
  const asOf = dateRange?.to ?? new Date()
  const members = await getActiveMembers(groupId, wsId, asOf)
  const memberPersonIds = new Set(members.map(m => m.personId))

  // All events in the date range for this workspace
  const eventWhere: Record<string, unknown> = { workspaceId: wsId }
  if (dateRange?.from || dateRange?.to) {
    eventWhere.timestamp = {
      ...(dateRange.from ? { gte: dateRange.from } : {}),
      ...(dateRange.to ? { lte: dateRange.to } : {}),
    }
  }

  const events = await db.event.findMany({
    where: eventWhere,
    include: {
      interactions: { select: { personId: true } },
      groupTags: { where: { id: groupId }, select: { id: true } },
    },
    orderBy: { timestamp: "desc" },
  })

  const results: Array<{
    id: string
    name: string
    type: string
    timestamp: Date
    placeId: string | null
    inferenceSource: GroupEventSource
  }> = []

  const memberCount = memberPersonIds.size

  for (const event of events) {
    const isExplicit = event.groupTags.length > 0

    let isMembership = false
    if (memberCount > 0) {
      const participatingMemberCount = event.interactions.filter(
        ix => ix.personId && memberPersonIds.has(ix.personId)
      ).length
      isMembership = participatingMemberCount / memberCount >= 0.5
    }

    if (!isExplicit && !isMembership) continue

    const inferenceSource: GroupEventSource =
      isExplicit && isMembership ? "both" : isExplicit ? "explicit" : "membership"

    results.push({
      id: event.id,
      name: event.name,
      type: event.type,
      timestamp: event.timestamp,
      placeId: event.placeId,
      inferenceSource,
    })
  }

  return results
}
