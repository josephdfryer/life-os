import { type NextRequest, NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import {
  finishStocktake,
  getStocktakeDetail,
  InventoryError,
  markItemMissing,
  moveItem,
  verifyStocktakeItem,
} from "@/lib/inventory"

async function respond(action: () => Promise<unknown>) {
  try {
    return NextResponse.json(await action())
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params
  return respond(() => getStocktakeDetail(db, access.workspaceId, id))
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params
  const body = await request.json().catch(() => null) as {
    action?: "verify" | "move" | "finish" | "mark_missing"
    itemId?: string
    destinationPlaceId?: string
    expectedFromPlaceId?: string | null
  } | null
  if (!body?.action) return NextResponse.json({ error: "Action is required" }, { status: 400 })

  if (body.action === "finish") {
    return respond(() => finishStocktake(db, access.workspaceId, id))
  }
  if (!body.itemId) return NextResponse.json({ error: "Item is required" }, { status: 400 })
  if (body.action === "verify") {
    return respond(() => verifyStocktakeItem(db, {
      workspaceId: access.workspaceId,
      stocktakeId: id,
      itemId: body.itemId!,
      actorPersonId: access.user.personId,
    }))
  }
  if (body.action === "mark_missing") {
    return respond(() => markItemMissing(db, {
      workspaceId: access.workspaceId,
      stocktakeId: id,
      itemId: body.itemId!,
    }))
  }
  if (body.action === "move" && body.destinationPlaceId && "expectedFromPlaceId" in body) {
    return respond(() => moveItem(db, {
      workspaceId: access.workspaceId,
      stocktakeId: id,
      itemId: body.itemId!,
      destinationPlaceId: body.destinationPlaceId!,
      expectedFromPlaceId: body.expectedFromPlaceId ?? null,
      actorPersonId: access.user.personId,
    }))
  }
  return NextResponse.json({ error: "Invalid stocktake action" }, { status: 400 })
}
