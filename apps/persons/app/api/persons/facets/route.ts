import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAccess } from "@/server/domain/access";
import { parseTags } from "@/lib/utils";

const FACET_FIELDS = [
  "title",
  "company",
  "location",
  "headline",
  "tags",
] as const;
type FacetField = (typeof FACET_FIELDS)[number];

function isFacetField(value: string | null): value is FacetField {
  return FACET_FIELDS.includes(value as FacetField);
}

export async function GET(req: NextRequest) {
  const actor = await requireAccess("people.read");
  const { searchParams } = new URL(req.url);
  const field = searchParams.get("field");
  const q = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    25,
    Math.max(1, Number(searchParams.get("limit") ?? 12)),
  );

  if (!isFacetField(field)) {
    return NextResponse.json(
      { error: "Unsupported facet field" },
      { status: 400 },
    );
  }

  // tags is a JSON-string array, not a plain scalar column — it needs
  // per-row parsing rather than a DB-level contains/count, so it gets its
  // own branch with a wider sample (parsing is cheap, the row scan isn't).
  if (field === "tags") {
    const rows = await db.person.findMany({
      where: { workspaceId: actor.workspaceId, tags: { not: "[]" } },
      select: { tags: true },
      take: 1000,
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of parseTags(row.tags)) {
        if (q && !tag.toLowerCase().includes(q.toLowerCase())) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const values = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));
    return NextResponse.json({ field, values });
  }

  const rows = await db.person.findMany({
    where: {
      workspaceId: actor.workspaceId,
      [field]: {
        not: null,
        ...(q ? { contains: q, mode: "insensitive" as const } : {}),
      },
    },
    select: { [field]: true },
    take: 500,
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = (row as unknown as Record<FacetField, string | null>)[
      field
    ]?.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const values = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));

  return NextResponse.json({ field, values });
}
