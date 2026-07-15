import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { centsToDollars } from "@life-os/db"
import { createInteraction } from "@/server/domain/interactions"
import { created, handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

export async function GET(req: NextRequest) {
  const actor = await requireAccess("interactions.read")
  const { searchParams } = new URL(req.url)
  const personId = searchParams.get("personId")

  const interactions = await db.interaction.findMany({
    where: { workspaceId: actor.workspaceId, ...(personId ? { personId } : {}) },
    include: { event: true, sourceFile: true },
    orderBy: { timestamp: "desc" },
  })

  return NextResponse.json(interactions.map(ix => ({ ...ix, amount: centsToDollars(ix.amount) })))
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("interactions.write")
    return created(await createInteraction(await req.json(), actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
