import { type NextRequest, NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { createInventoryLot, InventoryError } from "@/lib/inventory"

function dateOrNull(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function POST(request: NextRequest) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => null) as {
    definitionId?: string
    lotCode?: string
    manufacturedAt?: string | null
    receivedAt?: string | null
    expiresAt?: string | null
    notes?: string | null
  } | null
  if (!body?.definitionId || !body.lotCode) {
    return NextResponse.json({ error: "Definition and lot code are required" }, { status: 400 })
  }
  try {
    const lot = await createInventoryLot(db, {
      workspaceId: access.workspaceId,
      definitionId: body.definitionId,
      lotCode: body.lotCode,
      manufacturedAt: dateOrNull(body.manufacturedAt),
      receivedAt: dateOrNull(body.receivedAt),
      expiresAt: dateOrNull(body.expiresAt),
      notes: body.notes,
    })
    return NextResponse.json(lot, { status: 201 })
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }
}
