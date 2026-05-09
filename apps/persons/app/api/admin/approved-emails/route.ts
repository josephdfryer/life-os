import { NextRequest } from "next/server"
import { created, handleRouteError, json } from "@/server/api/respond"
import { accessOverview, addApprovedEmail, requireAccess } from "@/server/domain/access"

export async function GET() {
  try {
    const actor = await requireAccess("settings.manage")
    const overview = await accessOverview(actor)
    return json({ approvedEmails: overview.approvedEmails, workspaces: overview.workspaces })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("settings.manage")
    return created(await addApprovedEmail(await req.json(), actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
