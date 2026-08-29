import { badRequest, notFound } from "@/server/api/errors";
import { db } from "@/lib/db";
import { centsToDollars } from "@life-os/db";
import type { DomainActor } from "./audit";
import { runRulesForTarget } from "./rules";
import {
  createGroup as sharedCreateGroup,
  updateGroup as sharedUpdateGroup,
  deleteGroup as sharedDeleteGroup,
  addMember as sharedAddMember,
  removeMember as sharedRemoveMember,
  addPlaceAffiliation as sharedAddPlaceAffiliation,
  removePlaceAffiliation as sharedRemovePlaceAffiliation,
  addSubgroup as sharedAddSubgroup,
  GroupError,
  GROUP_TYPES,
  PLACE_GROUP_RELATIONSHIP_TYPES,
  type GroupType,
  type PlaceGroupRelationshipType,
} from "@life-os/domain";

export {
  GROUP_TYPES,
  PLACE_GROUP_RELATIONSHIP_TYPES,
  type GroupType,
  type PlaceGroupRelationshipType,
};

// Write operations moved to @life-os/domain/groups.ts (Track C, phase C4)
// — same shim pattern as persons.ts/plans.ts/events.ts/places.ts. Reads
// below (getGroup, listGroups, listMembers, sumInteractionsBy*,
// getGroupEvents) are unchanged. Fires new group.create/group.update
// triggers (packages/domain never depends on packages/automation).

function translate<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error) => {
    if (error instanceof GroupError)
      throw error.code === "not_found"
        ? notFound(error.message)
        : badRequest(error.message);
    throw error;
  });
}

export async function createGroup(
  input: Record<string, unknown>,
  actor: DomainActor,
) {
  const workspaceId = actor.workspaceId ?? "default-workspace";
  const group = await translate(sharedCreateGroup(input, workspaceId, actor));
  await runRulesForTarget({
    trigger: "group.create",
    targetType: "group",
    targetId: group.id,
    payload: {
      groupId: group.id,
      name: group.name,
      groupType: group.groupType,
    },
    actor,
  });
  return group;
}

export async function updateGroup(
  id: string,
  input: Record<string, unknown>,
  actor: DomainActor,
) {
  const workspaceId = actor.workspaceId ?? "default-workspace";
  const group = await translate(
    sharedUpdateGroup(id, input, workspaceId, actor),
  );
  await runRulesForTarget({
    trigger: "group.update",
    targetType: "group",
    targetId: id,
    payload: { groupId: id, fields: Object.keys(input) },
    actor,
  });
  return group;
}

export function deleteGroup(id: string, actor: DomainActor) {
  return translate(
    sharedDeleteGroup(id, actor.workspaceId ?? "default-workspace", actor),
  );
}

export function addMember(
  groupId: string,
  input: Record<string, unknown>,
  actor: DomainActor,
) {
  return translate(
    sharedAddMember(
      groupId,
      input,
      actor.workspaceId ?? "default-workspace",
      actor,
    ),
  );
}

export function removeMember(
  groupId: string,
  personId: string,
  actor: DomainActor,
) {
  return translate(
    sharedRemoveMember(
      groupId,
      personId,
      actor.workspaceId ?? "default-workspace",
      actor,
    ),
  );
}

export function addPlaceAffiliation(
  groupId: string,
  input: Record<string, unknown>,
  actor: DomainActor,
) {
  return translate(
    sharedAddPlaceAffiliation(
      groupId,
      input,
      actor.workspaceId ?? "default-workspace",
      actor,
    ),
  );
}

export function removePlaceAffiliation(
  groupId: string,
  placeId: string,
  actor: DomainActor,
) {
  return translate(
    sharedRemovePlaceAffiliation(
      groupId,
      placeId,
      actor.workspaceId ?? "default-workspace",
      actor,
    ),
  );
}

export function addSubgroup(
  parentGroupId: string,
  input: Record<string, unknown>,
  actor: DomainActor,
) {
  return translate(
    sharedAddSubgroup(
      parentGroupId,
      input,
      actor.workspaceId ?? "default-workspace",
      actor,
    ),
  );
}

// ─── Query: single group with relations ────────────────────────────────────────

export async function getGroup(
  id: string,
  workspaceId: string | null | undefined,
) {
  const wsId = workspaceId ?? "default-workspace";
  const group = await db.group.findFirst({
    where: { id, workspaceId: wsId },
    include: {
      personMembers: {
        where: { OR: [{ endDate: null }, { endDate: { gt: new Date() } }] },
        include: {
          person: {
            select: { id: true, first: true, last: true, title: true },
          },
        },
        orderBy: { startDate: "asc" },
      },
      placeAffiliations: {
        include: {
          place: {
            select: { id: true, name: true, type: true, address: true },
          },
        },
        orderBy: { startDate: "asc" },
      },
      taggedEvents: {
        where: { timestamp: { lte: new Date() } },
        orderBy: { timestamp: "desc" },
        take: 20,
        select: {
          id: true,
          name: true,
          type: true,
          timestamp: true,
          placeId: true,
        },
      },
      childGroups: {
        include: {
          child: { select: { id: true, name: true, groupType: true } },
        },
      },
      parentGroups: {
        include: {
          parent: { select: { id: true, name: true, groupType: true } },
        },
      },
    },
  });
  return group;
}

export async function listGroups(
  workspaceId: string | null | undefined,
  opts: { groupType?: string; search?: string; page?: number; limit?: number },
) {
  const wsId = workspaceId ?? "default-workspace";
  const page = Math.max(0, opts.page ?? 0);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));

  const AND: Record<string, unknown>[] = [{ workspaceId: wsId }];
  if (opts.groupType && GROUP_TYPES.includes(opts.groupType as GroupType)) {
    AND.push({ groupType: opts.groupType });
  }
  if (opts.search?.trim()) {
    AND.push({
      name: { contains: opts.search.trim(), mode: "insensitive" as const },
    });
  }

  const where = AND.length === 1 ? { workspaceId: wsId } : { AND };
  const [groups, total] = await Promise.all([
    db.group.findMany({
      where,
      include: {
        _count: { select: { personMembers: true, placeAffiliations: true } },
      },
      orderBy: { name: "asc" },
      skip: page * limit,
      take: limit,
    }),
    db.group.count({ where }),
  ]);

  return { groups, total, page, limit, hasMore: (page + 1) * limit < total };
}

export async function listMembers(
  groupId: string,
  workspaceId: string | null | undefined,
  asOf?: Date,
) {
  const wsId = workspaceId ?? "default-workspace";
  const group = await db.group.findFirst({
    where: { id: groupId, workspaceId: wsId },
  });
  if (!group) throw notFound("Group not found", { groupId });

  const cutoff = asOf ?? new Date();
  return db.personGroup.findMany({
    where: {
      groupId,
      startDate: { lte: cutoff },
      OR: [{ endDate: null }, { endDate: { gt: cutoff } }],
    },
    include: {
      person: {
        select: {
          id: true,
          first: true,
          last: true,
          title: true,
          emails: true,
        },
      },
    },
    orderBy: { startDate: "asc" },
  });
}

// ─── Query: active members at a point in time ─────────────────────────────────

export async function getActiveMembers(
  groupId: string,
  workspaceId: string | null | undefined,
  asOf?: Date,
) {
  return listMembers(groupId, workspaceId, asOf);
}

// ─── Query: financial rollups ─────────────────────────────────────────────────

export async function sumInteractionsByPlace(
  placeId: string,
  workspaceId: string | null | undefined,
  dateRange?: { from?: Date; to?: Date },
) {
  const wsId = workspaceId ?? "default-workspace";
  const where: Record<string, unknown> = {
    workspaceId: wsId,
    placeId,
    amount: { not: null },
  };
  if (dateRange?.from || dateRange?.to) {
    where.timestamp = {
      ...(dateRange.from ? { gte: dateRange.from } : {}),
      ...(dateRange.to ? { lte: dateRange.to } : {}),
    };
  }

  const result = await db.interaction.aggregate({
    where,
    _sum: { amount: true },
    _count: true,
  });

  return {
    placeId,
    total: centsToDollars(result._sum.amount ?? 0) ?? 0,
    count: result._count,
  };
}

export async function sumInteractionsByGroup(
  groupId: string,
  workspaceId: string | null | undefined,
  dateRange?: { from?: Date; to?: Date },
) {
  const wsId = workspaceId ?? "default-workspace";
  const affiliations = await db.placeGroup.findMany({
    where: { groupId },
    select: { placeId: true },
  });
  const placeIds = affiliations.map((a) => a.placeId);
  if (!placeIds.length) return { groupId, total: 0, count: 0, placeIds: [] };

  const events = await db.event.findMany({
    where: { workspaceId: wsId, placeId: { in: placeIds } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  if (!eventIds.length) return { groupId, total: 0, count: 0, placeIds };

  const where: Record<string, unknown> = {
    workspaceId: wsId,
    eventId: { in: eventIds },
    amount: { not: null },
  };
  if (dateRange?.from || dateRange?.to) {
    where.timestamp = {
      ...(dateRange.from ? { gte: dateRange.from } : {}),
      ...(dateRange.to ? { lte: dateRange.to } : {}),
    };
  }

  const result = await db.interaction.aggregate({
    where,
    _sum: { amount: true },
    _count: true,
  });
  return {
    groupId,
    total: centsToDollars(result._sum.amount ?? 0) ?? 0,
    count: result._count,
    placeIds,
  };
}

export async function sumInteractionsByGroupType(
  groupType: GroupType,
  workspaceId: string | null | undefined,
  dateRange?: { from?: Date; to?: Date },
) {
  const wsId = workspaceId ?? "default-workspace";
  const groups = await db.group.findMany({
    where: { workspaceId: wsId, groupType },
    select: { id: true },
  });

  const results = await Promise.all(
    groups.map((g) => sumInteractionsByGroup(g.id, workspaceId, dateRange)),
  );

  return {
    groupType,
    total: results.reduce((sum, r) => sum + r.total, 0),
    count: results.reduce((sum, r) => sum + r.count, 0),
    byGroup: results,
  };
}

// ─── Query: group events (inferred + explicit) ────────────────────────────────

export type GroupEventSource = "membership" | "explicit" | "both";

export async function getGroupEvents(
  groupId: string,
  workspaceId: string | null | undefined,
  dateRange?: { from?: Date; to?: Date },
) {
  const wsId = workspaceId ?? "default-workspace";
  const asOf = dateRange?.to ?? new Date();
  const members = await getActiveMembers(groupId, wsId, asOf);
  const memberPersonIds = new Set(members.map((m) => m.personId));

  const eventWhere: Record<string, unknown> = { workspaceId: wsId };
  if (dateRange?.from || dateRange?.to) {
    eventWhere.timestamp = {
      ...(dateRange.from ? { gte: dateRange.from } : {}),
      ...(dateRange.to ? { lte: dateRange.to } : {}),
    };
  }

  const events = await db.event.findMany({
    where: eventWhere,
    include: {
      interactions: { select: { personId: true } },
      groupTags: { where: { id: groupId }, select: { id: true } },
    },
    orderBy: { timestamp: "desc" },
  });

  const results: Array<{
    id: string;
    name: string;
    type: string;
    timestamp: Date;
    placeId: string | null;
    inferenceSource: GroupEventSource;
  }> = [];

  const memberCount = memberPersonIds.size;

  for (const event of events) {
    const isExplicit = event.groupTags.length > 0;

    let isMembership = false;
    if (memberCount > 0) {
      const participatingMemberCount = event.interactions.filter(
        (ix) => ix.personId && memberPersonIds.has(ix.personId),
      ).length;
      isMembership = participatingMemberCount / memberCount >= 0.5;
    }

    if (!isExplicit && !isMembership) continue;

    const inferenceSource: GroupEventSource =
      isExplicit && isMembership
        ? "both"
        : isExplicit
          ? "explicit"
          : "membership";

    results.push({
      id: event.id,
      name: event.name,
      type: event.type,
      timestamp: event.timestamp,
      placeId: event.placeId,
      inferenceSource,
    });
  }

  return results;
}
