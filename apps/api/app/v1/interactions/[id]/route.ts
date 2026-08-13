import { NextRequest, NextResponse } from "next/server"
import { contractIssues, interactionUpdateContract } from "@life-os/contracts"
import { deleteInteraction, updateInteraction } from "@life-os/domain"
import { authorizeRequest } from "@/lib/auth"
import { formatInteractionResource, getInteractionResource } from "@/lib/interactions"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "interactions.read")
  if (!auth) return unauthorizedResponse()
  try {
    const { id } = await params
    return NextResponse.json(await getInteractionResource(id, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "interactions.write")
  if (!auth) return unauthorizedResponse()
  try {
    const parsed = interactionUpdateContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid interaction update.", contractIssues(parsed.error))
    const { id } = await params
    return NextResponse.json(formatInteractionResource(await updateInteraction(id, parsed.data, auth.workspaceId, auth.actor)))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "interactions.write")
  if (!auth) return unauthorizedResponse()
  try {
    const { id } = await params
    await deleteInteraction(id, auth.workspaceId, auth.actor)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleRouteError(error)
  }
}
