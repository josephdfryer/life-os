import { type NextRequest, NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { createSupplier, InventoryError } from "@/lib/inventory"

export async function POST(request: NextRequest) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => null) as {
    name?: string
    supplierCode?: string | null
    email?: string | null
    phone?: string | null
    website?: string | null
    paymentTerms?: string | null
    notes?: string | null
  } | null
  if (!body?.name) return NextResponse.json({ error: "Supplier name is required" }, { status: 400 })
  try {
    const supplier = await createSupplier(db, { workspaceId: access.workspaceId, ...body, name: body.name })
    return NextResponse.json(supplier, { status: 201 })
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }
}
