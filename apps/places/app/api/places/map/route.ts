import { NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { getPlacesForMap } from "@/server/domain/places"

export async function GET() {
  try {
    const actor = await requireAccess("places.read")
    return NextResponse.json(await getPlacesForMap(actor.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
