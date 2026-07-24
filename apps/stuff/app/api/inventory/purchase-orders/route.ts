import { type NextRequest, NextResponse } from "next/server"
import { dollarsToCents } from "@life-os/db"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { createPurchaseOrder, InventoryError } from "@/lib/inventory"

function validDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function POST(request: NextRequest) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => null) as {
    supplierId?: string
    orderNumber?: string
    currency?: string | null
    orderedAt?: string | null
    expectedAt?: string | null
    notes?: string | null
    lines?: Array<{
      definitionId?: string
      orderedQuantity?: number
      unitCost?: number | null
      destinationPlaceId?: string | null
    }>
  } | null
  if (!body?.supplierId || !body.orderNumber || !body.lines) {
    return NextResponse.json({ error: "Supplier, order number, and lines are required" }, { status: 400 })
  }
  try {
    const order = await createPurchaseOrder(db, {
      workspaceId: access.workspaceId,
      supplierId: body.supplierId,
      orderNumber: body.orderNumber,
      currency: body.currency,
      orderedAt: validDate(body.orderedAt) ?? undefined,
      expectedAt: validDate(body.expectedAt),
      notes: body.notes,
      actorPersonId: access.user.personId,
      lines: body.lines.map((line) => ({
        definitionId: line.definitionId ?? "",
        orderedQuantity: Number(line.orderedQuantity),
        unitCost: dollarsToCents(line.unitCost),
        destinationPlaceId: line.destinationPlaceId,
      })),
    })
    return NextResponse.json(order, { status: 201 })
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }
}
