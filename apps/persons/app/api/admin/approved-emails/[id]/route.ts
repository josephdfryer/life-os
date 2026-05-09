import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess, updateApprovedEmail } from "@/server/domain/access"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAccess("settings.manage")
    const { id } = await params
    return json(await updateApprovedEmail(id, await req.json(), actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
