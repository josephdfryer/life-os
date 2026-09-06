import { cadenceDaysFor, daysSince, relationshipGapScore } from "@life-os/alignment/pure";
import { personDetailContract, personStatsContract, type PersonDetail, type PersonDetailInclude } from "@life-os/contracts";
import { formatInteractionResource } from "./interactions";
import { listNotes } from "./notes";
import { listPlans } from "./plans";
import {
  peoplePageContract,
  personResourceContract,
  type PersonResource,
} from "@life-os/contracts";
import { db } from "@life-os/db";

export class PeopleApiError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "validation",
  ) {
    super(message);
    this.name = "PeopleApiError";
  }
}

export type ListPeopleParams = {
  cursor?: string | null;
  limit?: number;
  q?: string | null;
};

type PersonRow = Awaited<ReturnType<typeof db.person.findFirstOrThrow>>;

export async function listPeople(
  params: ListPeopleParams,
  workspaceId: string,
) {
  const limit = boundedLimit(params.limit);
  const q = params.q?.trim() || null;
  if (q && q.length > 500)
    throw new PeopleApiError("q must be 500 characters or fewer", "validation");

  const and: Record<string, unknown>[] = [];
  if (q) {
    and.push({
      OR: [
        { first: { contains: q, mode: "insensitive" as const } },
        { last: { contains: q, mode: "insensitive" as const } },
        { nickname: { contains: q, mode: "insensitive" as const } },
        {
          emailSearch: {
            contains: q.toLowerCase(),
            mode: "insensitive" as const,
          },
        },
        { company: { contains: q, mode: "insensitive" as const } },
        { headline: { contains: q, mode: "insensitive" as const } },
      ],
    });
  }
  if (params.cursor) {
    const { createdAt, id } = decodePeopleCursor(params.cursor);
    and.push({
      OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: id } }],
    });
  }

  const rows = await db.person.findMany({
    where: { workspaceId, ...(and.length ? { AND: and } : {}) } as never,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return peoplePageContract.parse({
    data: page.map(formatPersonResource),
    nextCursor:
      hasMore && last ? encodePeopleCursor(last.createdAt, last.id) : null,
    hasMore,
    limit,
  });
}

// One request for a detail screen. Each include is one bounded query; stats
// are three counts plus the alignment score the attention endpoint uses, so
// the number a phone shows next to a name is the same number Home nudges on.
export async function getPersonDetail(
  id: string,
  workspaceId: string,
  include: ReadonlySet<PersonDetailInclude>,
  now = new Date(),
): Promise<PersonDetail> {
  const person = await db.person.findFirst({ where: { id, workspaceId } });
  if (!person) throw new PeopleApiError("Person not found", "not_found");
  const base = formatPersonResource(person);
  const wantStats = include.has("stats");
  const [latest, interactionCount, activePlanCount, noteCount, interactions, plans, notes] =
    await Promise.all([
      wantStats
        ? db.interaction.findFirst({
            where: { workspaceId, personId: id, timestamp: { lte: now } },
            orderBy: { timestamp: "desc" },
            select: { timestamp: true },
          })
        : null,
      wantStats ? db.interaction.count({ where: { workspaceId, personId: id } }) : 0,
      wantStats ? db.plan.count({ where: { workspaceId, personId: id, status: "active" } }) : 0,
      wantStats ? db.note.count({ where: { workspaceId, aboutPersonId: id } }) : 0,
      include.has("interactions")
        ? db.interaction.findMany({
            where: { workspaceId, personId: id },
            orderBy: [{ timestamp: "desc" }, { id: "desc" }],
            take: DETAIL_INTERACTIONS,
            include: {
              event: { select: { id: true, name: true, type: true } },
              sourceFile: { select: { id: true, filename: true } },
            },
          })
        : null,
      include.has("plans")
        ? listPlans({ personId: id, status: "active", limit: DETAIL_PLANS }, workspaceId)
        : null,
      include.has("notes")
        ? listNotes({ aboutPersonId: id, limit: DETAIL_NOTES }, workspaceId)
        : null,
    ]);
  const detail: PersonDetail = { ...base };
  if (wantStats) {
    const lastInteractionAt = latest?.timestamp ?? null;
    const hasActivePlan = activePlanCount > 0;
    detail.stats = personStatsContract.parse({
      interactionCount,
      lastInteractionAt: lastInteractionAt?.toISOString() ?? null,
      daysSinceLast: lastInteractionAt ? daysSince(lastInteractionAt, now) : null,
      activePlanCount,
      noteCount,
      attentionScore: relationshipGapScore({ closeness: person.closeness, lastInteractionAt, hasActivePlan }),
      cadenceDays: cadenceDaysFor(person.closeness, hasActivePlan),
    });
  }
  if (interactions) detail.interactions = interactions.map(formatInteractionResource);
  if (plans) detail.plans = plans.data;
  if (notes) detail.recentNotes = notes.data;
  return personDetailContract.parse(detail);
}

const DETAIL_INTERACTIONS = 50;
const DETAIL_PLANS = 20;
const DETAIL_NOTES = 20;

export async function getPersonResource(id: string, workspaceId: string) {
  const person = await db.person.findFirst({ where: { id, workspaceId } });
  if (!person) throw new PeopleApiError("Person not found", "not_found");
  return formatPersonResource(person);
}

export function formatPersonResource(person: PersonRow): PersonResource {
  return personResourceContract.parse({
    id: person.id,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
    first: person.first,
    last: person.last,
    nickname: person.nickname,
    title: person.title,
    headline: person.headline,
    company: person.company,
    emails: storedStringList(person.emails),
    phones: storedStringList(person.phones),
    birthday: person.birthday,
    closeness: person.closeness,
    tags: storedStringList(person.tags),
    values: storedStringList(person.values),
    notes: person.notes,
    location: person.location,
    linkedin: person.linkedin,
    twitter: person.twitter,
    website: person.website,
    facebook: person.facebook,
    instagram: person.instagram,
    color: person.color,
    colorSoft: person.colorSoft,
  });
}

function boundedLimit(value: number | undefined) {
  if (value !== undefined && !Number.isFinite(value))
    throw new PeopleApiError("limit must be a number", "validation");
  return Math.min(500, Math.max(1, Math.round(value ?? 100)));
}

export function storedStringList(raw: string): string[] {
  if (!raw) return [];
  if (!raw.trim().startsWith("[")) return splitLegacyValue(raw);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .flatMap(splitLegacyValue);
  } catch {
    return [];
  }
}

function splitLegacyValue(value: string) {
  return value
    .split(" ::: ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function encodePeopleCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString(
    "base64url",
  );
}

function decodePeopleCursor(cursor: string) {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new PeopleApiError("cursor is not valid base64url", "validation");
  }
  const separator = decoded.indexOf("|");
  if (separator <= 0)
    throw new PeopleApiError("cursor is malformed", "validation");
  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !id)
    throw new PeopleApiError("cursor is malformed", "validation");
  return { createdAt, id };
}
