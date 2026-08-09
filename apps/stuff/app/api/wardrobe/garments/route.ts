import { NextResponse } from "next/server"
import { createId } from "@paralleldrive/cuid2"
import { db } from "@/lib/db"
import { requireStuffAccess } from "@/lib/access"
import { createItemInTransaction } from "@life-os/domain"
import { fireItemCreateRules } from "@/lib/item-commands"

type GarmentInput = {
  name?: string
  garmentType?: string
  category?: string
  colors?: string[]
  material?: string | null
  pattern?: string | null
  season?: string[]
  formality?: string | null
  brand?: string | null
  confidence?: number
}

export async function POST(request: Request) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json() as { sourceFileId?: string; garments?: GarmentInput[] }
  if (!body.sourceFileId || !Array.isArray(body.garments) || body.garments.length === 0) {
    return NextResponse.json({ error: "At least one reviewed garment is required." }, { status: 400 })
  }

  const sourceFile = await db.importedFile.findFirst({
    where: { id: body.sourceFileId, workspaceId: access.workspaceId },
    select: { id: true },
  })
  if (!sourceFile) return NextResponse.json({ error: "Photograph not found." }, { status: 404 })

  const valid = body.garments.filter((garment) => garment.name?.trim())
  if (valid.length === 0) return NextResponse.json({ error: "Each garment needs a name." }, { status: 400 })
  const actor = { type: "user" as const, id: access.user.id, workspaceId: access.workspaceId }
  const created = await db.$transaction(tx => Promise.all(valid.map((garment) => createItemInTransaction(tx, {
      name: garment.name!.trim(),
      assetId: `#WRD-${createId().slice(-6).toUpperCase()}`,
      category: garment.category?.trim() || "Clothing",
      make: garment.brand?.trim() || undefined,
      tags: [
        garment.garmentType,
        ...(garment.colors ?? []),
        ...(garment.season ?? []),
        garment.formality,
      ].filter(Boolean).join(", "),
      color: garment.colors?.[0] || undefined,
      primaryImageFileId: sourceFile.id,
      attributes: JSON.stringify({
        garmentType: garment.garmentType || null,
        colors: garment.colors ?? [],
        material: garment.material || null,
        pattern: garment.pattern || null,
        season: garment.season ?? [],
        formality: garment.formality || null,
        analysisConfidence: garment.confidence ?? null,
        source: "ai_reviewed",
      }),
      ownedById: access.user.personId ?? undefined,
    }, access.workspaceId, { actor }).then(item => ({ id: item.id, name: item.name, assetId: item.assetId })),
  )))
  await Promise.all(created.map(item => fireItemCreateRules(item, access.workspaceId, actor)))

  return NextResponse.json({ items: created }, { status: 201 })
}
