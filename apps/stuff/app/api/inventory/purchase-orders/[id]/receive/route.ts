import { type NextRequest, NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { InventoryError, receivePurchaseOrder } from "@/lib/inventory"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params
  const body = await request.json().catch(() => null) as {
    receiptFileId?: string | null
    receivedAt?: string | null
    lines?: Array<{
      orderLineId?: string
      quantity?: number
      itemId?: string | null
      lotId?: string | null
      serialNumber?: string | null
      destinationPlaceId?: string | null
    }>
  } | null
  if (!body?.lines) return NextResponse.json({ error: "Receipt lines are required" }, { status: 400 })
  try {
    const result = await receivePurchaseOrder(db, {
      workspaceId: access.workspaceId,
      purchaseOrderId: id,
      actorPersonId: access.user.personId,
      receiptFileId: body.receiptFileId,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : undefined,
      lines: body.lines.map((line) => ({
        orderLineId: line.orderLineId ?? "",
        quantity: Number(line.quantity),
        itemId: line.itemId,
        lotId: line.lotId,
        serialNumber: line.serialNumber,
        destinationPlaceId: line.destinationPlaceId,
      })),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }
}
