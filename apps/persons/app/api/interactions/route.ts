import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { createInteraction } from "@/server/domain/interactions"
import { created, handleRouteError } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const personId = searchParams.get("personId")

  const interactions = await db.interaction.findMany({
    where: personId ? { personId } : undefined,
    include: { event: true, sourceFile: true },
    orderBy: { timestamp: "desc" },
  })

  return NextResponse.json(interactions)
}

export async function POST(req: NextRequest) {
  try {
    return created(await createInteraction(await req.json()))
  } catch (error) {
    return handleRouteError(error)
  }
}
