import type { GraphEventActor } from "./events"
import { publishGraphEvent } from "./events"
import type { AuditActor } from "./audit"
import { writeAuditLog } from "./audit"

type Actor = GraphEventActor & AuditActor

// Organization aggregates. See docs/ORGANIZATION_AGGREGATE_STRATEGY.md.
//
// The whole design rests on Interaction.groupId being stamped when the
// interaction happens rather than inferred at query time from employment dates.
// That is what keeps history attached to the organization after a person moves
// on, and what lets spend — which has no person to infer from — belong to an
// organization at all.

export type OrganizationDossier = {
  group: { id: string; name: string; groupType: string }
  interactions: {
    total: number
    byType: Array<{ type: string; count: number }>
    firstAt: Date | null
    lastAt: Date | null
  }
  spend: { total: number; count: number }
  people: Array<{ personId: string; name: string; role: string | null; current: boolean }>
  places: Array<{ placeId: string; name: string; relationshipType: string }>
  facts: Array<{ type: string; value: string; recordedAt: Date }>
  notes: Array<{ id: string; timestamp: Date; content: string }>
}

/**
 * Everything known about one organization, from the five paths that can reach it.
 * Deliberately one query set over Interaction rather than a union of separate
 * systems: meetings, emails and purchases are already the same row shape.
 */
export async function getOrganizationDossier(
  groupId: string,
  workspaceId = "default-workspace",
  options: { noteLimit?: number; factLimit?: number } = {},
): Promise<OrganizationDossier | null> {
  const { db } = await import("@life-os/db")
  const group = await db.group.findFirst({
    where: { id: groupId, workspaceId },
    select: { id: true, name: true, groupType: true },
  })
  if (!group) return null

  const [byType, spendAgg, bounds, memberships, places, facts, notes] = await Promise.all([
    db.interaction.groupBy({
      by: ["type"],
      where: { workspaceId, groupId },
      _count: { _all: true },
    }),
    db.interaction.aggregate({
      where: { workspaceId, groupId, type: "financial" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.interaction.aggregate({
      where: { workspaceId, groupId },
      _min: { timestamp: true },
      _max: { timestamp: true },
    }),
    db.personGroup.findMany({
      where: { groupId },
      select: {
        role: true, endDate: true,
        person: { select: { id: true, first: true, last: true } },
      },
    }),
    db.placeGroup.findMany({
      where: { groupId },
      select: { relationshipType: true, place: { select: { id: true, name: true } } },
    }),
    db.state.findMany({
      where: { workspaceId, entityType: "Group", entityId: groupId },
      orderBy: { recordedAt: "desc" },
      take: options.factLimit ?? 50,
      select: { recordedAt: true, definition: { select: { type: true, value: true } } },
    }),
    db.note.findMany({
      where: { workspaceId, aboutGroupId: groupId },
      orderBy: { timestamp: "desc" },
      take: options.noteLimit ?? 20,
      select: { id: true, timestamp: true, content: true },
    }),
  ])

  return {
    group,
    interactions: {
      total: byType.reduce((sum, row) => sum + row._count._all, 0),
      byType: byType.map(row => ({ type: row.type, count: row._count._all })).sort((a, b) => b.count - a.count),
      firstAt: bounds._min.timestamp ?? null,
      lastAt: bounds._max.timestamp ?? null,
    },
    spend: { total: spendAgg._sum.amount ?? 0, count: spendAgg._count._all },
    // A membership with no endDate is current. Past members stay listed — their
    // interactions remain part of the history with this organization.
    people: memberships.map(m => ({
      personId: m.person.id,
      name: `${m.person.first} ${m.person.last}`.trim(),
      role: m.role,
      current: m.endDate === null,
    })),
    places: places.map(p => ({ placeId: p.place.id, name: p.place.name, relationshipType: p.relationshipType })),
    facts: facts.map(f => ({ type: f.definition.type, value: f.definition.value, recordedAt: f.recordedAt })),
    notes,
  }
}

/**
 * Attribute an interaction to an organization, or re-attribute it.
 *
 * Re-attribution is allowed — a mis-resolved merchant has to be fixable — but it
 * is never silent. Every change publishes a GraphEvent carrying the previous and
 * new groupId, so "why does this interaction say Estée Lauder" stays answerable
 * and a bad bulk sweep can be traced row by row.
 */
export async function setInteractionGroup(
  interactionId: string,
  groupId: string | null,
  workspaceId = "default-workspace",
  actor?: Actor,
) {
  const { db } = await import("@life-os/db")

  const existing = await db.interaction.findFirst({
    where: { id: interactionId, workspaceId },
    select: { id: true, groupId: true },
  })
  if (!existing) throw new Error("Interaction not found")
  if (groupId) {
    const group = await db.group.findFirst({ where: { id: groupId, workspaceId }, select: { id: true } })
    if (!group) throw new Error("Group not found")
  }
  if (existing.groupId === groupId) return { changed: false, from: existing.groupId, to: groupId }

  await db.$transaction(async tx => {
    await tx.interaction.update({ where: { id: interactionId }, data: { groupId } })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Interaction",
      subjectId: interactionId,
      // Distinct from interaction.update so the attribution history can be read
      // on its own — one event per interaction, never one per bulk sweep.
      eventType: existing.groupId ? "interaction.reattributed" : "interaction.attributed",
      actor,
      idempotencyKey: `interaction-group:${interactionId}:${groupId ?? "none"}:${Date.now()}`,
      payload: { from: existing.groupId, to: groupId },
    })
  })
  await writeAuditLog({
    actor,
    action: existing.groupId ? "interaction.reattributed" : "interaction.attributed",
    targetType: "interaction",
    targetId: interactionId,
  })
  return { changed: true, from: existing.groupId, to: groupId }
}

/** Organizations worth showing as relationships: derived from signal, not declared by type. */
export async function listRelationshipOrganizations(workspaceId = "default-workspace", limit = 25) {
  const { db } = await import("@life-os/db")
  // An organization is a relationship when it has people or non-financial
  // contact — not because of its groupType. That keeps 611 auto-generated
  // merchant rollups out of the view without a separate namespace for them.
  const [withPeople, withContact] = await Promise.all([
    db.personGroup.findMany({ select: { groupId: true }, distinct: ["groupId"] }),
    db.interaction.findMany({
      where: { workspaceId, groupId: { not: null }, type: { not: "financial" } },
      select: { groupId: true },
      distinct: ["groupId"],
    }),
  ])
  const ids = [...new Set([
    ...withPeople.map(r => r.groupId),
    ...withContact.map(r => r.groupId).filter((id): id is string => Boolean(id)),
  ])]
  if (!ids.length) return []
  return db.group.findMany({
    where: { id: { in: ids }, workspaceId },
    select: { id: true, name: true, groupType: true },
    orderBy: { name: "asc" },
    take: limit,
  })
}
