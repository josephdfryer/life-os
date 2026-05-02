import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

const FACET_FIELDS = ["title", "company", "location", "headline"] as const
type FacetField = typeof FACET_FIELDS[number]

function isFacetField(value: string | null): value is FacetField {
  return FACET_FIELDS.includes(value as FacetField)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const field = searchParams.get("field")
  const q = searchParams.get("q")?.trim() ?? ""
  const limit = Math.min(25, Math.max(1, Number(searchParams.get("limit") ?? 12)))

  if (!isFacetField(field)) {
    return NextResponse.json({ error: "Unsupported facet field" }, { status: 400 })
  }

  const rows = await db.person.findMany({
    where: {
      [field]: {
        not: null,
        ...(q ? { contains: q } : {}),
      },
    },
    select: { [field]: true },
    take: 500,
  })

  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = (row as unknown as Record<FacetField, string | null>)[field]?.trim()
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  const values = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }))

  return NextResponse.json({ field, values })
}
