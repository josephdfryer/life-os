import { NextRequest, NextResponse } from "next/server"
import { deleteInteraction } from "@/server/domain/interactions"
import { handleRouteError } from "@/server/api/respond"

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteInteraction(id)
    return NextResponse.json({ deleted: id })
  } catch (err) {
    return handleRouteError(err)
  }
}
