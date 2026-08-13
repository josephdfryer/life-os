import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { badRequest } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"
import { getPublicProfileSettings, setPublicProfileEnabled, setPublicProfileSlug } from "@/server/domain/public-profile"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("people.read")
    return json(await getPublicProfileSettings(id, actor.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("people.write")
    const body = await req.json()

    if (typeof body?.slug === "string") {
      return json(await setPublicProfileSlug(id, actor.workspaceId, body.slug))
    }
    if (typeof body?.enabled === "boolean") {
      return json(await setPublicProfileEnabled(id, actor.workspaceId, body.enabled))
    }
    throw badRequest("Provide either `enabled` (boolean) or `slug` (string)", body)
  } catch (error) {
    return handleRouteError(error)
  }
}
