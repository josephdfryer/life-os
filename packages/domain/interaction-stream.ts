// The continuous interaction stream.
//
// One feed over everything that has happened — calls, meals, messages,
// calendar, transactions — instead of a page per person. Two entry points:
// this one walks rows, `aggregateInteractions` answers "how much / how many"
// without shipping the rows at all.
//
// Moved from apps/persons/server/domain/interaction-stream.ts (342 lines,
// already tested and in production behind /api/v1/interactions) so apps/api
// can serve the canonical /v1/stream endpoints from the same implementation
// Persons already proved out, rather than a rewrite. Persons keeps a shim at
// the old path (see apps/persons/server/domain/interaction-stream.ts).
//
// Two decisions worth knowing about:
//
// Keyset, not offset. `OFFSET 10000` makes SQLite walk and discard 10,000 rows
// before returning anything, so page 100 costs a hundred times page 1. A cursor
// on (timestamp, id) turns every page into an index seek.
//
// No total by default. Counting the filtered set is usually more expensive than
// the page itself, and almost nothing uses the number. Ask for it with
// `withTotal` when you actually want it.

import { centsToDollars } from "@life-os/db";

export class InteractionStreamError extends Error {
  code: "validation";
  constructor(message: string) {
    super(message);
    this.name = "InteractionStreamError";
    this.code = "validation";
  }
}

export type StreamParams = {
  cursor?: string | null;
  limit?: number;
  order?: "desc" | "asc";
  type?: string | null;
  subtype?: string | null;
  since?: string | null;
  until?: string | null;
  personId?: string | null;
  actorPersonId?: string | null;
  groupId?: string | null;
  placeId?: string | null;
  eventId?: string | null;
  category?: string | null;
  direction?: string | null;
  source?: string | null;
  q?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  include?: string | null;
  withTotal?: boolean;
};

/** (timestamp, id) — id breaks ties so a page boundary can never drop or repeat a row. */
export function encodeCursor(timestamp: Date, id: string): string {
  return Buffer.from(`${timestamp.toISOString()}|${id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(cursor: string): { timestamp: Date; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new InteractionStreamError("cursor is not valid base64url");
  }
  // Split at the FIRST separator: an ISO timestamp never contains one, but an
  // id might, and splitting at the last would hand the extra segments to the
  // timestamp and truncate the id.
  const separator = decoded.indexOf("|");
  if (separator <= 0) throw new InteractionStreamError("cursor is malformed");
  const timestamp = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(timestamp.getTime()) || !id)
    throw new InteractionStreamError("cursor is malformed");
  return { timestamp, id };
}

function parseDate(
  value: string | null | undefined,
  field: string,
): Date | undefined {
  if (!value) return undefined;
  // A bare date means the whole day in the caller's terms; time-of-day is the
  // caller's business, so it is passed through untouched when supplied.
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value,
  );
  if (Number.isNaN(date.getTime()))
    throw new InteractionStreamError(`${field} is not a valid date`);
  return date;
}

const csv = (value: string | null | undefined) =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

function buildWhere(params: StreamParams, workspaceId: string) {
  const and: Record<string, unknown>[] = [];

  const types = csv(params.type);
  if (types.length) and.push({ type: { in: types } });
  const subtypes = csv(params.subtype);
  if (subtypes.length) and.push({ subtype: { in: subtypes } });

  const since = parseDate(params.since, "since");
  const until = parseDate(params.until, "until");
  if (since || until) {
    and.push({
      timestamp: {
        ...(since ? { gte: since } : {}),
        ...(until ? { lt: until } : {}),
      },
    });
  }

  if (params.personId) and.push({ personId: params.personId });
  if (params.actorPersonId) and.push({ actorPersonId: params.actorPersonId });
  if (params.placeId) and.push({ placeId: params.placeId });
  if (params.eventId) and.push({ eventId: params.eventId });
  if (params.category)
    and.push({
      category: { contains: params.category, mode: "insensitive" as const },
    });
  if (params.direction) and.push({ direction: params.direction });
  if (params.source) and.push({ source: params.source });

  if (params.minAmount != null)
    and.push({ amount: { gte: Math.round(params.minAmount) } });
  if (params.maxAmount != null)
    and.push({ amount: { lte: Math.round(params.maxAmount) } });

  if (params.q) {
    and.push({
      OR: [
        { merchantName: { contains: params.q, mode: "insensitive" as const } },
        { summary: { contains: params.q, mode: "insensitive" as const } },
      ],
    });
  }

  // A household is its members' own spending plus whatever is attributed to the
  // group itself — joint accounts have no single owner, so they only appear
  // through the participant edge.
  if (params.groupId) {
    and.push({
      OR: [
        {
          actorPerson: {
            groupMemberships: { some: { groupId: params.groupId } },
          },
        },
        {
          participants: {
            some: { entityType: "Group", entityId: params.groupId },
          },
        },
      ],
    });
  }

  return { workspaceId, ...(and.length ? { AND: and } : {}) };
}

function buildInclude(include: string | null | undefined) {
  const wanted = new Set(csv(include));
  return {
    // Opt-in only. The previous route joined event and sourceFile on every row
    // whether or not the caller wanted them.
    ...(wanted.has("person")
      ? {
          person: {
            select: { id: true, first: true, last: true, company: true },
          },
        }
      : {}),
    ...(wanted.has("place")
      ? { place: { select: { id: true, name: true, googlePlaceId: true } } }
      : {}),
    ...(wanted.has("event")
      ? { event: { select: { id: true, name: true, start: true } } }
      : {}),
    ...(wanted.has("account")
      ? {
          accountLink: {
            select: {
              id: true,
              institution: true,
              accountName: true,
              isShared: true,
            },
          },
        }
      : {}),
    ...(wanted.has("actor")
      ? { actorPerson: { select: { id: true, first: true, last: true } } }
      : {}),
    ...(wanted.has("participants")
      ? {
          participants: {
            select: {
              entityType: true,
              entityId: true,
              role: true,
              band: true,
              confidence: true,
            },
          },
        }
      : {}),
  };
}

export async function streamInteractions(
  params: StreamParams,
  workspaceId: string,
) {
  const { db } = await import("@life-os/db");
  const limit = Math.min(500, Math.max(1, Math.round(params.limit ?? 100)));
  const order = params.order === "asc" ? "asc" : "desc";
  const where = buildWhere(params, workspaceId) as Record<string, unknown>;

  if (params.cursor) {
    const { timestamp, id } = decodeCursor(params.cursor);
    // Strictly after the cursor row in the sort order, tie-broken on id.
    const seek =
      order === "desc"
        ? [{ timestamp: { lt: timestamp } }, { timestamp, id: { lt: id } }]
        : [{ timestamp: { gt: timestamp } }, { timestamp, id: { gt: id } }];
    where.AND = [...((where.AND as unknown[]) ?? []), { OR: seek }];
  }

  // One extra row is the cheapest possible "is there more".
  const rows = await db.interaction.findMany({
    where: where as never,
    include: buildInclude(params.include),
    orderBy: [{ timestamp: order }, { id: order }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  const total = params.withTotal
    ? await db.interaction.count({
        where: buildWhere(params, workspaceId) as never,
      })
    : undefined;

  return {
    data: page.map(formatStreamRow),
    nextCursor: hasMore && last ? encodeCursor(last.timestamp, last.id) : null,
    hasMore,
    limit,
    ...(total !== undefined ? { total } : {}),
  };
}

type StreamRow = {
  timestamp: Date;
  id: string;
  amount?: number | null;
} & Record<string, unknown>;

function formatStreamRow(row: StreamRow) {
  const amountCents = typeof row.amount === "number" ? row.amount : null;
  return {
    ...row,
    // `amount` stays in dollars for compatibility with the existing endpoint;
    // `amountCents` is the exact stored integer for anything doing arithmetic.
    amount: centsToDollars(amountCents),
    amountCents,
    cursor: encodeCursor(row.timestamp, row.id),
  };
}

// ── Aggregate ───────────────────────────────────────────────────────────────

/**
 * Whitelisted grouping expressions. The value is interpolated into SQL, so it
 * can only ever come from this map — never from the request.
 */
const GROUP_BY: Record<string, { sql: string; join?: string; label: string }> =
  {
    type: { sql: `i."type"`, label: "type" },
    subtype: { sql: `COALESCE(i."subtype", 'unclassified')`, label: "subtype" },
    direction: {
      sql: `COALESCE(i."direction", 'unknown')`,
      label: "direction",
    },
    category: {
      sql: `COALESCE(NULLIF(i."category", ''), 'uncategorized')`,
      label: "category",
    },
    merchant: {
      sql: `COALESCE(NULLIF(i."merchantName", ''), i."summary", 'unknown')`,
      label: "merchant",
    },
    source: { sql: `COALESCE(i."source", 'manual')`, label: "source" },
    // SQLite stores DateTime as ISO text, so a prefix is the period.
    month: { sql: `substr(i."timestamp", 1, 7)`, label: "month" },
    day: { sql: `substr(i."timestamp", 1, 10)`, label: "day" },
    actor: {
      sql: `COALESCE(ap."first" || ' ' || ap."last", 'unattributed')`,
      join: `LEFT JOIN "Person" ap ON ap."id" = i."actorPersonId"`,
      label: "actor",
    },
    person: {
      sql: `COALESCE(cp."first" || ' ' || cp."last", 'none')`,
      join: `LEFT JOIN "Person" cp ON cp."id" = i."personId"`,
      label: "person",
    },
    place: {
      sql: `pl."name"`,
      join: `LEFT JOIN "Place" pl ON pl."id" = i."placeId"`,
      label: "place",
    },
    account: {
      sql: `COALESCE(al."institution" || ' ' || al."accountName", 'none')`,
      join: `LEFT JOIN "EraAccountLink" al ON al."id" = i."accountLinkId"`,
      label: "account",
    },
  };

const METRICS = new Set(["sum", "count", "avg", "max", "min"]);

export async function aggregateInteractions(
  params: StreamParams & { groupBy?: string | null; metric?: string | null },
  workspaceId: string,
) {
  const { db } = await import("@life-os/db");
  const key = params.groupBy ?? "category";
  const grouping = GROUP_BY[key];
  if (!grouping) {
    throw new InteractionStreamError(
      `groupBy must be one of: ${Object.keys(GROUP_BY).join(", ")}`,
    );
  }
  const metric = params.metric ?? "sum";
  if (!METRICS.has(metric)) {
    throw new InteractionStreamError(
      `metric must be one of: ${[...METRICS].join(", ")}`,
    );
  }
  const limit = Math.min(200, Math.max(1, Math.round(params.limit ?? 25)));

  const { clauses, values } = rawFilters(params, workspaceId);
  const aggregate =
    metric === "count" ? `COUNT(*)` : `${metric.toUpperCase()}(i."amount")`;

  // Ordinals in GROUP BY / ORDER BY, and aliases that cannot collide with a
  // column on a joined table. `AS name … GROUP BY name` binds to Place."name",
  // not the alias, which silently collapses every bucket into one.
  const sql = `
    SELECT ${grouping.sql} AS bucket, ${aggregate} AS metric_value, COUNT(*) AS row_count
      FROM "Interaction" i
      ${grouping.join ?? ""}
     WHERE ${clauses.join(" AND ")}
     GROUP BY 1
     ORDER BY 2 DESC, 3 DESC
     LIMIT ${limit}`;

  const rows = await db.$queryRawUnsafe<
    { bucket: string | null; metric_value: number | null; row_count: number }[]
  >(sql, ...values);

  const [totals] = await db.$queryRawUnsafe<
    { total: number | null; n: number }[]
  >(
    `SELECT SUM(i."amount") AS total, COUNT(*) AS n FROM "Interaction" i ${grouping.join ?? ""} WHERE ${clauses.join(" AND ")}`,
    ...values,
  );

  const inDollars = metric !== "count";
  // SQLite's SUM() over an integer column comes back as a BigInt on the
  // better-sqlite3 adapter (though not libSQL/Turso) — normalize to Number
  // before centsToDollars, which does not accept BigInt.
  const totalCents = Number(totals?.total ?? 0);
  return {
    groupBy: grouping.label,
    metric,
    total: centsToDollars(totalCents),
    totalCents,
    count: Number(totals?.n ?? 0),
    groups: rows
      .filter((row) => row.bucket !== null)
      .map((row) => {
        const metricValue = Number(row.metric_value ?? 0);
        return {
          key: String(row.bucket),
          value: inDollars ? centsToDollars(metricValue) : metricValue,
          valueCents: inDollars ? metricValue : undefined,
          count: Number(row.row_count),
        };
      }),
  };
}

/**
 * The same filters as the stream, as parameterised SQL.
 *
 * Dates bind as Date objects, never strings: timestamps are stored as
 * "…+00:00" and toISOString() ends in "Z". SQLite compares TEXT, '+' sorts
 * before 'Z', and the two forms differ at exactly a range boundary — which for
 * date-only transactions is an entire day of data.
 */
function rawFilters(params: StreamParams, workspaceId: string) {
  const clauses: string[] = [`i."workspaceId" = ?`];
  const values: unknown[] = [workspaceId];

  const push = (clause: string, ...args: unknown[]) => {
    clauses.push(clause);
    values.push(...args);
  };

  const types = csv(params.type);
  if (types.length)
    push(`i."type" IN (${types.map(() => "?").join(",")})`, ...types);
  const subtypes = csv(params.subtype);
  if (subtypes.length)
    push(`i."subtype" IN (${subtypes.map(() => "?").join(",")})`, ...subtypes);

  const since = parseDate(params.since, "since");
  const until = parseDate(params.until, "until");
  if (since) push(`i."timestamp" >= ?`, since);
  if (until) push(`i."timestamp" < ?`, until);

  if (params.personId) push(`i."personId" = ?`, params.personId);
  if (params.actorPersonId) push(`i."actorPersonId" = ?`, params.actorPersonId);
  if (params.placeId) push(`i."placeId" = ?`, params.placeId);
  if (params.eventId) push(`i."eventId" = ?`, params.eventId);
  if (params.direction) push(`i."direction" = ?`, params.direction);
  if (params.source) push(`i."source" = ?`, params.source);
  if (params.category)
    push(
      `LOWER(COALESCE(i."category", '')) LIKE ?`,
      `%${params.category.toLowerCase()}%`,
    );
  if (params.minAmount != null)
    push(`i."amount" >= ?`, Math.round(params.minAmount));
  if (params.maxAmount != null)
    push(`i."amount" <= ?`, Math.round(params.maxAmount));
  if (params.q) {
    push(
      `(LOWER(COALESCE(i."merchantName", '')) LIKE ? OR LOWER(COALESCE(i."summary", '')) LIKE ?)`,
      `%${params.q.toLowerCase()}%`,
      `%${params.q.toLowerCase()}%`,
    );
  }
  if (params.groupId) {
    push(
      `(EXISTS (SELECT 1 FROM "PersonGroup" pg WHERE pg."personId" = i."actorPersonId" AND pg."groupId" = ?)
        OR EXISTS (SELECT 1 FROM "InteractionParticipant" ip
                    WHERE ip."interactionId" = i."id" AND ip."entityType" = 'Group' AND ip."entityId" = ?))`,
      params.groupId,
      params.groupId,
    );
  }

  return { clauses, values };
}
