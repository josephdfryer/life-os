import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { updateInteraction, deleteInteraction } from "@/server/domain/interactions"
import { formatInteraction } from "@/server/domain/dto"
import { handleRouteError, noContent } from "@/server/api/respond"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  if (!(await authorizeApiRequest(req, "interactions.read"))) return unauthorized()
  const { id } = await params

  const interaction = await db.interaction.findUnique({
    where: { id },
    include: { event: true, sourceFile: true },
  })

  if (!interaction) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(formatInteraction(interaction))
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "interactions.write")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    return NextResponse.json(await updateInteraction(id, await req.json(), auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "interactions.write")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    await deleteInteraction(id, auth.actor)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
