import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { centsToDollars } from "@life-os/db";
import { parseTags } from "@/lib/utils";
import { enrichWithAttention } from "@/lib/attention";
import type { Interaction } from "@/types";
import { createPerson } from "@/server/domain/persons";
import { created, handleRouteError } from "@/server/api/respond";
import { requireAccess } from "@/server/domain/access";
import {
  personListViewFilter,
  type PersonListView,
} from "@/lib/person-list-presentation";
import {
  personListInclude,
  serializePersonListRow,
} from "@/server/queries/person-list";
import { filtersFromParam, type Filter } from "@/lib/filters";

// Presence checks for the 15 non-multiselect filter fields — "has_value" is the
// existing per-field truthiness rule the old FIELD_CHIPS scheme already used;
// "is_empty" is its exact inverse. emails/phones are JSON-array-string columns
// ("[]" means empty); first/last are non-nullable strings ("" means empty);
// everything else is a nullable string column.
const FIELD_TO_COLUMN: Record<string, string> = {
  email: "emails",
  phone: "phones",
};
const ARRAY_STRING_FIELDS = new Set(["email", "phone"]);
const REQUIRED_STRING_FIELDS = new Set(["first", "last"]);

function presenceCheck(field: string): Record<string, unknown> {
  if (ARRAY_STRING_FIELDS.has(field)) return { not: "[]" };
  if (REQUIRED_STRING_FIELDS.has(field)) return { not: "" };
  return { not: null };
}

function emptinessCheck(field: string): Record<string, unknown> {
  if (ARRAY_STRING_FIELDS.has(field)) return { equals: "[]" };
  if (REQUIRED_STRING_FIELDS.has(field)) return { equals: "" };
  return { equals: null };
}

export async function GET(req: NextRequest) {
  const actor = await requireAccess("people.read");
  const { searchParams } = new URL(req.url);
  const minimal = searchParams.get("minimal") === "true";

  // ── Lightweight paginated list (contacts page, import matching) ──────────────
  if (minimal) {
    const page = Math.max(0, parseInt(searchParams.get("page") ?? "0"));
    const limit = Math.min(
      200,
      Math.max(1, parseInt(searchParams.get("limit") ?? "50")),
    );
    const search = searchParams.get("search")?.trim() ?? "";
    const sort = searchParams.get("sort") ?? "name";
    const requestedView = searchParams.get("view") ?? "all";
    const view: PersonListView = ["attention", "active", "no-history"].includes(
      requestedView,
    )
      ? (requestedView as PersonListView)
      : "all";

    const filters: Filter[] = filtersFromParam(searchParams.get("filters"));

    const AND: Record<string, unknown>[] = [];
    // Split into tokens so "Paul G" matches first="Paul" AND last starts with "G"
    const tokens = search.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      AND.push({
        OR: [
          { first: { contains: token, mode: "insensitive" as const } },
          { last: { contains: token, mode: "insensitive" as const } },
          { nickname: { contains: token, mode: "insensitive" as const } },
          { emails: { contains: token, mode: "insensitive" as const } },
          { title: { contains: token, mode: "insensitive" as const } },
          { company: { contains: token, mode: "insensitive" as const } },
          { headline: { contains: token, mode: "insensitive" as const } },
          { notes: { contains: token, mode: "insensitive" as const } },
          { location: { contains: token, mode: "insensitive" as const } },
        ],
      });
    }
    for (const f of filters) {
      if (f.field === "tags") {
        const tags = (f.value as string[]).filter(Boolean);
        if (tags.length > 0) {
          // Person.tags is a JSON-string array (same storage pattern as emails/
          // phones above). Matching the quoted substring `"tag"` approximates
          // exact-element matching without a second parse-and-filter pass —
          // same pragmatic tradeoff the rest of this route already accepts for
          // emails/phones `contains` search. A tag that is itself a substring
          // of another tag's name (e.g. "vip" inside "vip-adjacent") can
          // false-positive; acceptable for a directory filter, not a ledger.
          AND.push({
            OR: tags.map((tag) => ({
              tags: {
                contains: JSON.stringify(tag).slice(1, -1),
                mode: "insensitive" as const,
              },
            })),
          });
        }
        continue;
      }
      if (f.field === "group") {
        const groupIds = (f.value as string[]).filter(Boolean);
        if (groupIds.length > 0)
          AND.push({
            groupMemberships: { some: { groupId: { in: groupIds } } },
          });
        continue;
      }
      const col = FIELD_TO_COLUMN[f.field] ?? f.field;
      if (f.operator === "has_value")
        AND.push({ [col]: presenceCheck(f.field) });
      else if (f.operator === "is_empty")
        AND.push({ [col]: emptinessCheck(f.field) });
      else if (
        f.operator === "contains" &&
        typeof f.value === "string" &&
        f.value.trim()
      )
        AND.push({
          [col]: { contains: f.value.trim(), mode: "insensitive" as const },
        });
    }
    const now = new Date();
    const viewFilter = personListViewFilter(view, now);
    if (viewFilter) AND.push(viewFilter);
    const where = AND.length
      ? { workspaceId: actor.workspaceId, AND }
      : { workspaceId: actor.workspaceId };

    const orderBy =
      sort === "closeness"
        ? [{ closeness: "desc" as const }, { last: "asc" as const }]
        : sort === "recent"
          ? [{ createdAt: "desc" as const }]
          : [{ last: "asc" as const }, { first: "asc" as const }];

    const [rows, total] = await Promise.all([
      db.person.findMany({
        where,
        orderBy,
        skip: page * limit,
        take: limit,
        include: personListInclude(now),
      }),
      db.person.count({ where }),
    ]);

    return NextResponse.json({
      persons: rows.map(serializePersonListRow),
      total,
      page,
      limit,
      hasMore: (page + 1) * limit < total,
    });
  }

  // ── Full load with attention enrichment (individual use cases only) ──────────
  const persons = await db.person.findMany({
    where: { workspaceId: actor.workspaceId },
    include: {
      interactions: {
        where: { timestamp: { lte: new Date() } },
        select: {
          id: true,
          createdAt: true,
          personId: true,
          eventId: true,
          type: true,
          timestamp: true,
          duration: true,
          emotionalWeight: true,
          outcome: true,
          summary: true,
          notes: true,
          actionItems: true,
          billable: true,
          amount: true,
          direction: true,
          sourceFileId: true,
        },
        orderBy: { timestamp: "desc" },
        take: 10,
      },
      plans: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const enriched = persons.map((p: (typeof persons)[number]) => {
    const interactions: Interaction[] = p.interactions.map(
      (ix: (typeof p.interactions)[number]) => ({
        ...ix,
        actionItems: parseTags(ix.actionItems) as unknown as string[],
        amount: centsToDollars(ix.amount),
        event: null,
        sourceFile: null,
      }),
    ) as unknown as Interaction[];

    const person = {
      ...p,
      tags: parseTags(p.tags),
      values: parseTags(p.values),
      emails: parseTags(p.emails),
      phones: parseTags(p.phones),
      interactions,
      plans: p.plans,
    };

    return enrichWithAttention(
      person as unknown as Parameters<typeof enrichWithAttention>[0],
    );
  });

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("people.write");
    const person = await createPerson(await req.json(), actor.actor);
    return created(person);
  } catch (error) {
    return handleRouteError(error);
  }
}
