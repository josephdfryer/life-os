import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireStuffAccess } from "@/lib/access"

export async function POST(request: Request) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json() as {
    personId?: string
    itemIds?: string[]
    sourceFileId?: string
    timestamp?: string
    duration?: number | null
    placeId?: string | null
    summary?: string | null
  }

  const personId = body.personId || access.user.personId
  const itemIds = [...new Set(body.itemIds ?? [])]
  if (!personId) return NextResponse.json({ error: "Choose who wore the outfit." }, { status: 400 })
  if (itemIds.length === 0) return NextResponse.json({ error: "Choose at least one garment." }, { status: 400 })

  const [person, items, sourceFile, place] = await Promise.all([
    db.person.findFirst({ where: { id: personId, workspaceId: access.workspaceId }, select: { id: true } }),
    db.item.findMany({ where: { id: { in: itemIds }, workspaceId: access.workspaceId }, select: { id: true, name: true } }),
    body.sourceFileId
      ? db.importedFile.findFirst({ where: { id: body.sourceFileId, workspaceId: access.workspaceId }, select: { id: true } })
      : null,
    body.placeId
      ? db.place.findFirst({ where: { id: body.placeId, workspaceId: access.workspaceId }, select: { id: true } })
      : null,
  ])
  if (!person || items.length !== itemIds.length) {
    return NextResponse.json({ error: "One or more outfit participants were not found." }, { status: 404 })
  }
  if (body.sourceFileId && !sourceFile) return NextResponse.json({ error: "Photograph not found." }, { status: 404 })
  if (body.placeId && !place) return NextResponse.json({ error: "Place not found." }, { status: 404 })

  const timestamp = body.timestamp ? new Date(body.timestamp) : new Date()
  if (Number.isNaN(timestamp.getTime())) return NextResponse.json({ error: "Choose a valid date and time." }, { status: 400 })

  const interaction = await db.interaction.create({
    data: {
      workspaceId: access.workspaceId,
      personId,
      placeId: place?.id,
      sourceFileId: sourceFile?.id,
      type: "outfit_worn",
      timestamp,
      duration: body.duration && body.duration > 0 ? Math.round(body.duration) : undefined,
      summary: body.summary?.trim() || `Wore ${items.map((item) => item.name).join(", ")}`,
      itemInteractions: {
        create: items.map((item) => ({ itemId: item.id, role: "worn" })),
      },
      participants: {
        create: [
          { entityType: "Person", entityId: personId, role: "wearer", workspaceId: access.workspaceId },
          ...items.map((item) => ({
            entityType: "Item",
            entityId: item.id,
            role: "worn",
            workspaceId: access.workspaceId,
          })),
          ...(place ? [{
            entityType: "Place",
            entityId: place.id,
            role: "location",
            workspaceId: access.workspaceId,
          }] : []),
        ],
      },
    },
    select: { id: true, timestamp: true, summary: true },
  })

  return NextResponse.json(interaction, { status: 201 })
}
