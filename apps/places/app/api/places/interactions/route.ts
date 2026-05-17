import { NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { getInteractionLayerItems } from "@/server/domain/map-layers"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const actor = await requireAccess("interactions.read")
    const url = new URL(request.url)
    const placeIds = url.searchParams.get("placeIds")?.split(",").map(id => id.trim()).filter(Boolean) ?? []
    return NextResponse.json(await getInteractionLayerItems(actor.workspaceId, placeIds))
  } catch (error) {
    return handleRouteError(error)
  }
}
