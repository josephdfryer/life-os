import { type NextRequest, NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { adjustItemQuantity, configureItemTracking, InventoryError } from "@/lib/inventory"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params
  const body = await request.json().catch(() => null) as {
    action?: "adjust" | "configure"
    delta?: number
    reason?: string
    definitionId?: string | null
    lotId?: string | null
    serialNumber?: string | null
  } | null
  if (!body?.action) return NextResponse.json({ error: "Action is required" }, { status: 400 })

  try {
    if (body.action === "adjust" && typeof body.delta === "number" && body.reason) {
      return NextResponse.json(await adjustItemQuantity(db, {
        workspaceId: access.workspaceId,
        actorPersonId: access.user.personId,
        itemId: id,
        delta: body.delta,
        reason: body.reason,
      }))
    }
    if (body.action === "configure" && "definitionId" in body) {
      await configureItemTracking(db, {
        workspaceId: access.workspaceId,
        itemId: id,
        definitionId: body.definitionId ?? null,
        lotId: body.lotId ?? null,
        serialNumber: body.serialNumber ?? null,
      })
      return NextResponse.json({ itemId: id })
    }
    return NextResponse.json({ error: "Invalid stock action" }, { status: 400 })
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }
}
