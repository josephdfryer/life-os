import { type NextRequest, NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const query = request.nextUrl.searchParams.get("q")?.trim()
  if (!query) return NextResponse.json({ error: "A scan value is required" }, { status: 400 })

  const [item, place] = await Promise.all([
    db.item.findFirst({
      where: {
        workspaceId: access.workspaceId,
        OR: [{ id: query }, { assetId: query }, { name: { equals: query } }],
      },
      select: { id: true, name: true, assetId: true, placeId: true },
    }),
    db.place.findFirst({
      where: {
        workspaceId: access.workspaceId,
        OR: [{ id: query }, { name: { equals: query } }],
      },
      select: { id: true, name: true, parentPlaceId: true },
    }),
  ])
  if (item) return NextResponse.json({ kind: "item", value: item })
  if (place) return NextResponse.json({ kind: "place", value: place })
  return NextResponse.json({ error: "No matching item or place" }, { status: 404 })
}
