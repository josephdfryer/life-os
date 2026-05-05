import { NextRequest, NextResponse } from "next/server"
import { deleteInteraction } from "@/server/domain/interactions"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await requireAccess("interactions.write")
    await deleteInteraction(id, actor.actor)
    return NextResponse.json({ deleted: id })
  } catch (err) {
    return handleRouteError(err)
  }
}
