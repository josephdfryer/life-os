import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { centsToDollars } from "@life-os/db"
import { createInteraction } from "@/server/domain/interactions"
import { created, handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { cursorPage, dateKeysetSeek, parsePageRequest } from "@/server/api/date-keyset"

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAccess("interactions.read")
    const { searchParams } = new URL(req.url)
    const personId = searchParams.get("personId")
    const { cursor, limit } = parsePageRequest(searchParams, { limit: 100 })
    const where = {
      workspaceId: actor.workspaceId,
      ...(personId ? { personId } : {}),
      ...(cursor ? { AND: [dateKeysetSeek("timestamp", cursor, "desc")] } : {}),
    }

    const interactions = await db.interaction.findMany({
      where,
      include: { event: true, sourceFile: true },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: limit + 1,
    })
    const page = cursorPage(interactions, limit, interaction => interaction.timestamp)

    return NextResponse.json({
      ...page,
      data: page.data.map(ix => ({ ...ix, amount: centsToDollars(ix.amount) })),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("interactions.write")
    return created(await createInteraction(await req.json(), actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
