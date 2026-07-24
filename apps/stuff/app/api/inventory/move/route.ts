import { type NextRequest, NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { InventoryError, moveItem } from "@/lib/inventory"

export async function POST(request: NextRequest) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => null) as {
    itemId?: string
    destinationPlaceId?: string
    expectedFromPlaceId?: string | null
    stocktakeId?: string | null
  } | null
  if (!body?.itemId || !body.destinationPlaceId || !("expectedFromPlaceId" in body)) {
    return NextResponse.json({ error: "Item, destination, and expected location are required" }, { status: 400 })
  }

  try {
    const result = await moveItem(db, {
      workspaceId: access.workspaceId,
      actorPersonId: access.user.personId,
      itemId: body.itemId,
      destinationPlaceId: body.destinationPlaceId,
      expectedFromPlaceId: body.expectedFromPlaceId ?? null,
      stocktakeId: body.stocktakeId,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }
}
