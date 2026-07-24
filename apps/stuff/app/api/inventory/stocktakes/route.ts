import { type NextRequest, NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { InventoryError, startStocktake } from "@/lib/inventory"

export async function POST(request: NextRequest) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => null) as {
    placeId?: string
    includeDescendants?: boolean
  } | null
  if (!body?.placeId) return NextResponse.json({ error: "Place is required" }, { status: 400 })

  try {
    const event = await startStocktake(db, {
      workspaceId: access.workspaceId,
      placeId: body.placeId,
      includeDescendants: body.includeDescendants ?? true,
      actorPersonId: access.user.personId,
    })
    return NextResponse.json({ id: event.id }, { status: 201 })
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }
}
