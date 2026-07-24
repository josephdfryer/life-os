import { NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { getProcurementOverview } from "@/lib/inventory"

export async function GET() {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await getProcurementOverview(db, access.workspaceId))
}
