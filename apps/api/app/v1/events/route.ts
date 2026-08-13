import { NextRequest, NextResponse } from "next/server"
import { contractIssues, eventCreateContract } from "@life-os/contracts"
import { createEventPrimitive } from "@life-os/domain"
import { authorizeRequest } from "@/lib/auth"
import { formatEventResource, listEvents } from "@/lib/events"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "life-events.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { searchParams } = new URL(req.url)
    const rawLimit = searchParams.get("limit")
    return NextResponse.json(await listEvents({
      cursor: searchParams.get("cursor"),
      limit: rawLimit === null || rawLimit === "" ? undefined : Number(rawLimit),
      type: searchParams.get("type"),
      placeId: searchParams.get("placeId"),
    }, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "life-events.write")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = eventCreateContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid event.", contractIssues(parsed.error))
    const event = await createEventPrimitive(parsed.data, auth.workspaceId, auth.actor)
    return NextResponse.json(formatEventResource(event), { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
