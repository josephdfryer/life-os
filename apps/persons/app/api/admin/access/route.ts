import { handleRouteError, json } from "@/server/api/respond"
import { accessOverview, requireAccess, seedDefaultAccess } from "@/server/domain/access"

export async function GET() {
  try {
    const actor = await requireAccess("settings.manage")
    return json(await accessOverview(actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST() {
  try {
    const actor = await requireAccess("settings.manage")
    await seedDefaultAccess(actor.actor)
    return json(await accessOverview(actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
