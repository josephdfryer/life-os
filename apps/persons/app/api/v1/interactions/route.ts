import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { createInteraction } from "@/server/domain/interactions"
import { formatInteraction } from "@/server/domain/dto"
import { created, handleRouteError } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "interactions.read")
  if (!auth) return unauthorized()

  const { searchParams } = new URL(req.url)
  const personId = searchParams.get("personId")
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? 100)))
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0))

  const [interactions, total] = await Promise.all([
    db.interaction.findMany({
      where: { workspaceId: auth.workspaceId, ...(personId ? { personId } : {}) },
      include: { event: true, sourceFile: true },
      orderBy: { timestamp: "desc" },
      take: limit,
      skip: offset,
    }),
    db.interaction.count({ where: { workspaceId: auth.workspaceId, ...(personId ? { personId } : {}) } }),
  ])

  return NextResponse.json({ data: interactions.map(formatInteraction), total, limit, offset })
}

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "interactions.write")
  if (!auth) return unauthorized()
  try {
    return created(await createInteraction(await req.json(), auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
