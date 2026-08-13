import { NextRequest, NextResponse } from "next/server"
import { contractIssues, eventUpdateContract } from "@life-os/contracts"
import { deleteEventPrimitive, updateEventPrimitive } from "@life-os/domain"
import { authorizeRequest } from "@/lib/auth"
import { formatEventResource, getEventResource } from "@/lib/events"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "life-events.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    return NextResponse.json(await getEventResource(id, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "life-events.write")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = eventUpdateContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid event update.", contractIssues(parsed.error))
    const { id } = await params
    const event = await updateEventPrimitive(id, parsed.data, auth.workspaceId, auth.actor)
    return NextResponse.json(formatEventResource(event))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "life-events.write")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    await deleteEventPrimitive(id, auth.workspaceId, auth.actor)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleRouteError(error)
  }
}
