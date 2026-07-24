import { type NextRequest, NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { createItemDefinition, InventoryError } from "@/lib/inventory"

function errorResponse(error: unknown) {
  if (error instanceof InventoryError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  throw error
}

export async function GET() {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const definitions = await db.itemDefinition.findMany({
    where: { workspaceId: access.workspaceId, active: true },
    include: {
      items: { select: { quantity: true } },
      lots: { select: { id: true, lotCode: true, expiresAt: true } },
    },
    orderBy: { name: "asc" },
  })
  return NextResponse.json(definitions.map((definition) => ({
    ...definition,
    quantity: definition.items.reduce((sum, item) => sum + item.quantity, 0),
  })))
}

export async function POST(request: NextRequest) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => null) as {
    name?: string
    sku?: string | null
    category?: string | null
    description?: string | null
    unit?: string | null
    trackingMode?: "untracked" | "lot" | "serial"
    reorderPoint?: number | null
    targetStock?: number | null
    defaultShelfLifeDays?: number | null
  } | null
  if (!body?.name) return NextResponse.json({ error: "Name is required" }, { status: 400 })
  try {
    const definition = await createItemDefinition(db, {
      workspaceId: access.workspaceId,
      name: body.name,
      sku: body.sku,
      category: body.category,
      description: body.description,
      unit: body.unit,
      trackingMode: body.trackingMode,
      reorderPoint: body.reorderPoint,
      targetStock: body.targetStock,
      defaultShelfLifeDays: body.defaultShelfLifeDays,
    })
    return NextResponse.json(definition, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
